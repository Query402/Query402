import type { QueryMode, QueryResult } from "@query402/shared";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import {
  getPaymentEvidence,
  paymentEvidenceSummary,
  persistPaymentEvidence,
  setPaidRequestRecord,
  type PaidRequestRecord
} from "../payment-evidence.js";
import {
  abortIdempotency,
  beginIdempotency,
  buildRequestHash,
  completeIdempotency,
  respondIdempotencyGate
} from "./route.js";
import { getResponseByPaymentProof, savePaymentProofResponse } from "./service.js";
import { getProviderById } from "../pricing.js";
import {
  PaymentProofError,
  assertProofCoversQuery,
  proofFromHeader,
  queryCoverageDigest
} from "../query-proof.js";

async function persistDemoEvidenceIfNeeded(input: { req: Request; record: PaidRequestRecord }) {
  const evidence = getPaymentEvidence(input.req);
  if (evidence?.kind === "demo") {
    await persistPaymentEvidence(evidence, input.record);
  }
}

function buildPaidResponse(req: Request, result: QueryResult) {
  const evidence = getPaymentEvidence(req);
  const network = evidence?.network ?? config.STELLAR_NETWORK;
  const facilitatorUrl = evidence?.facilitatorUrl ?? config.X402_FACILITATOR_URL;
  const payTo = evidence?.payTo ?? config.X402_PAY_TO_ADDRESS;
  const evidencePayload = evidence
    ? paymentEvidenceSummary(evidence)
    : {
        kind: "verified" as const,
        status: "settlement-pending" as const,
        network,
        payTo,
        facilitatorUrl
      };
  return {
    traceId: result.traceId,
    payment: {
      network,
      facilitatorUrl,
      evidence: evidencePayload
    },
    result
  };
}

function paymentProofKey(req: Request): string | null {
  const evidence = getPaymentEvidence(req);
  if (evidence?.kind === "settled" && evidence.transactionHash) {
    return evidence.transactionHash;
  }

  if (evidence?.kind === "demo") {
    const demoProof = req.header("payment-response")?.trim();
    if (!demoProof) {
      return null;
    }

    const payer = evidence.payer ?? req.header("x-demo-payer") ?? "demo-agent";
    const provider = typeof req.query.provider === "string" ? req.query.provider : "unknown";
    return `demo:${req.path}:${provider}:${payer}:${demoProof}`;
  }

  return null;
}

export async function handlePaidX402Route(
  req: Request,
  res: Response,
  next: NextFunction,
  input: {
    mode: QueryMode;
    route: string;
    provider: string;
    queryOrUrl: string;
    query?: string;
    url?: string;
    execute: () => Promise<QueryResult>;
  }
) {
  try {
    const catalogProvider = getProviderById(input.provider);
    if (!catalogProvider || catalogProvider.category !== input.mode) {
      return res.status(400).json({ error: "unknown_provider" });
    }

    const evidence = getPaymentEvidence(req);
    const proofKey = paymentProofKey(req);
    const fingerprint = {
      method: "GET" as const,
      route: input.route,
      mode: input.mode,
      provider: input.provider,
      query: input.query,
      url: input.url,
      payer: evidence?.payer ?? req.header("x-demo-payer") ?? "unknown",
      network: config.STELLAR_NETWORK,
      quotedAmountUsd: catalogProvider.priceUsd,
      paymentReference: proofKey
    };

    const gate = beginIdempotency(req, fingerprint);
    if (respondIdempotencyGate(res, gate)) {
      return;
    }

    const requestHash = buildRequestHash(fingerprint);

    // Payment-proof replay must bind the same request body hash. A reused proof
    // with a different query is rejected rather than answered from cache.
    if (proofKey) {
      const existing = getResponseByPaymentProof(proofKey, requestHash);
      if (existing.hit) {
        return res.status(200).json(existing.body);
      }
      if (existing.conflict) {
        return res.status(409).json({ error: "payment_proof_conflict" });
      }
    }

    const price = catalogProvider.priceUsd.toString();
    const asset = evidence?.asset ?? "USDC";
    const amount = evidence?.amount ?? price;
    let proof = {
      digest: queryCoverageDigest({
        provider: input.provider,
        target: input.queryOrUrl,
        price
      }),
      asset,
      amount
    };
    try {
      const headerProof = proofFromHeader(req);
      if (headerProof) {
        proof = headerProof;
      }
      assertProofCoversQuery({
        provider: input.provider,
        target: input.queryOrUrl,
        price,
        asset,
        amount,
        proof
      });
    } catch (error) {
      if (error instanceof PaymentProofError) {
        abortIdempotency(req);
        return res.status(402).json({ error: "payment_proof_mismatch" });
      }
      throw error;
    }

    const result = await input.execute();
    const record: PaidRequestRecord = {
      mode: input.mode,
      endpoint: input.route,
      providerId: input.provider,
      queryOrUrl: input.queryOrUrl,
      priceUsd: result.priceUsd,
      latencyMs: result.latencyMs,
      traceId: result.traceId
    };

    setPaidRequestRecord(req, record);
    await persistDemoEvidenceIfNeeded({ req, record });

    const body = buildPaidResponse(req, result);

    if (proofKey) {
      savePaymentProofResponse(proofKey, body, requestHash);
    }

    completeIdempotency(req, fingerprint, 200, body);
    return res.status(200).json(body);
  } catch (error) {
    abortIdempotency(req);
    return next(error);
  }
}
