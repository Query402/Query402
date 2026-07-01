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
  completeIdempotency,
  respondIdempotencyGate
} from "./route.js";
import { getResponseByPaymentProof, savePaymentProofResponse } from "./service.js";
import { getProviderById } from "../pricing.js";

async function persistDemoEvidenceIfNeeded(input: { req: Request; record: PaidRequestRecord }) {
  const evidence = getPaymentEvidence(input.req);
  if (evidence?.kind === "demo") {
    await persistPaymentEvidence(evidence, input.record);
  }
}

function buildPaidResponse(req: Request, result: QueryResult) {
  const evidence = getPaymentEvidence(req);
  return {
    traceId: result.traceId,
    payment: {
      network: evidence?.network ?? config.STELLAR_NETWORK,
      facilitatorUrl: evidence?.facilitatorUrl ?? config.X402_FACILITATOR_URL,
      evidence: evidence
        ? paymentEvidenceSummary(evidence)
        : { kind: "verified", status: "settlement-pending" }
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
    const fingerprint = {
      method: "GET" as const,
      route: input.route,
      mode: input.mode,
      provider: input.provider,
      query: input.query,
      url: input.url,
      payer: evidence?.payer ?? req.header("x-demo-payer") ?? "unknown",
      network: config.STELLAR_NETWORK,
      quotedAmountUsd: catalogProvider.priceUsd
    };

    const gate = beginIdempotency(req, fingerprint);
    if (respondIdempotencyGate(res, gate)) {
      return;
    }

    const proofKey = paymentProofKey(req);
    if (proofKey) {
      const existing = getResponseByPaymentProof(proofKey);
      if (existing) {
        return res.status(200).json(existing);
      }
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
      savePaymentProofResponse(proofKey, body);
    }

    completeIdempotency(req, fingerprint, 200, body);
    return res.status(200).json(body);
  } catch (error) {
    abortIdempotency(req);
    return next(error);
  }
}
