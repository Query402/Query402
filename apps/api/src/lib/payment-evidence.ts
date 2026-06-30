import { nanoid } from "nanoid";
import type { NextFunction, Request, Response } from "express";
import type { PaymentAttempt, QueryMode, UsageEvent } from "@query402/shared";
import { buildPaymentProofLinks } from "@query402/shared";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse
} from "@x402/core/types";
import type { HTTPRequestContext } from "@x402/core/server";
import { config } from "./config.js";
import { getProviderById } from "./pricing.js";
import { persistPaymentAndUsage, savePaymentAttempt } from "./persistence.js";

export type PaymentEvidence =
  DemoPaymentEvidence | VerifiedPaymentEvidence | SettledPaymentEvidence | FailedPaymentEvidence;

export type DemoPaymentEvidence = EvidenceBase & {
  kind: "demo";
  status: "demo-paid";
  payer?: string;
};

export type VerifiedPaymentEvidence = EvidenceBase & {
  kind: "verified";
  status: "verified";
  payer?: string;
  facilitatorResult: VerifyResponse;
};

export type SettledPaymentEvidence = EvidenceBase & {
  kind: "settled";
  status: "settled";
  payer?: string;
  transactionHash?: string;
  facilitatorResult: SettleResponse;
};

export type FailedPaymentEvidence = EvidenceBase & {
  kind: "failed";
  status: "failed";
  payer?: string;
  error: string;
  facilitatorResult?: VerifyResponse | SettleResponse;
};

type EvidenceBase = {
  mode: QueryMode;
  endpoint: string;
  providerId: string;
  amountUsd: number;
  network: string;
  asset?: string;
  amount?: string;
  payTo: string;
  facilitatorUrl: string;
};

export type PaidRequestRecord = {
  mode: QueryMode;
  endpoint: string;
  providerId: string;
  queryOrUrl: string;
  priceUsd: number;
  latencyMs: number;
  traceId: string;
};

type EvidenceRequest = Request & {
  paymentEvidence?: PaymentEvidence;
  paidRequestRecord?: PaidRequestRecord;
};

type ExpressBackedAdapter = HTTPRequestContext["adapter"] & {
  req?: Request;
};

export class PaymentEvidenceError extends Error {
  constructor(message = "Payment evidence rejected") {
    super(message);
    this.name = "PaymentEvidenceError";
  }
}

export function formatUsdPrice(value: number) {
  return `$${value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function routeModeFromPath(pathname: string): QueryMode | null {
  if (pathname.endsWith("/search")) {
    return "search";
  }
  if (pathname.endsWith("/news")) {
    return "news";
  }
  if (pathname.endsWith("/scrape")) {
    return "scrape";
  }
  return null;
}

export function expectedProviderPrice(providerId: string, mode: QueryMode) {
  const provider = getProviderById(providerId);
  if (!provider || provider.category !== mode) {
    throw new PaymentEvidenceError("Payment evidence does not match requested provider");
  }

  return provider.priceUsd;
}

function getProviderFromRequest(req: Request) {
  const rawProvider = req.query.provider;
  return Array.isArray(rawProvider) ? rawProvider[0] : rawProvider;
}

function decodeBase64Json(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as unknown;
}

export function paymentPayloadFromHeader(paymentHeader?: string): PaymentPayload | null {
  if (!paymentHeader) {
    return null;
  }

  try {
    const parsed = decodeBase64Json(paymentHeader);
    if (parsed && typeof parsed === "object" && "accepted" in parsed) {
      return parsed as PaymentPayload;
    }
  } catch {
    return null;
  }

  return null;
}

export function requirementsFromPaymentHeader(paymentHeader?: string): PaymentRequirements | null {
  const payload = paymentPayloadFromHeader(paymentHeader);
  return payload?.accepted ?? null;
}

function assertPriceMatchesProvider(evidence: EvidenceBase) {
  const expectedPrice = expectedProviderPrice(evidence.providerId, evidence.mode);
  if (formatUsdPrice(expectedPrice) !== formatUsdPrice(evidence.amountUsd)) {
    throw new PaymentEvidenceError("Payment amount does not match requested provider");
  }
}

export function assertRequestMatchesEvidence(req: Request, evidence: PaymentEvidence) {
  const mode = routeModeFromPath(req.path);
  const providerId = getProviderFromRequest(req);
  if (!mode || typeof providerId !== "string") {
    throw new PaymentEvidenceError("Payment evidence does not match request");
  }

  if (
    evidence.mode !== mode ||
    evidence.providerId !== providerId ||
    evidence.endpoint !== req.path
  ) {
    throw new PaymentEvidenceError("Payment evidence does not match request");
  }

  expectedProviderPrice(providerId, mode);
  assertPriceMatchesProvider(evidence);
}

export function buildEvidenceFromRequirements(input: {
  req: Request;
  requirements: PaymentRequirements;
  paymentPayload?: PaymentPayload;
  verifyResult?: VerifyResponse;
  settleResult?: SettleResponse;
  failure?: string;
}): PaymentEvidence {
  const mode = routeModeFromPath(input.req.path);
  const providerId = getProviderFromRequest(input.req);
  if (!mode || typeof providerId !== "string") {
    throw new PaymentEvidenceError("Payment evidence does not match request");
  }

  const amountUsd = expectedProviderPrice(providerId, mode);
  const base: EvidenceBase = {
    mode,
    endpoint: input.req.path,
    providerId,
    amountUsd,
    network: input.requirements.network,
    asset: input.requirements.asset,
    amount: input.requirements.amount,
    payTo: input.requirements.payTo,
    facilitatorUrl: config.X402_FACILITATOR_URL
  };

  if (input.failure) {
    return {
      ...base,
      kind: "failed",
      status: "failed",
      payer: input.verifyResult?.payer ?? input.settleResult?.payer,
      error: input.failure,
      facilitatorResult: input.settleResult ?? input.verifyResult
    };
  }

  if (input.settleResult) {
    if (!input.settleResult.success) {
      return {
        ...base,
        kind: "failed",
        status: "failed",
        payer: input.settleResult.payer,
        error: input.settleResult.errorReason ?? "settlement_failed",
        facilitatorResult: input.settleResult
      };
    }

    return {
      ...base,
      kind: "settled",
      status: "settled",
      payer: input.settleResult.payer,
      transactionHash: input.settleResult.transaction || undefined,
      facilitatorResult: input.settleResult
    };
  }

  if (input.verifyResult) {
    if (!input.verifyResult.isValid) {
      return {
        ...base,
        kind: "failed",
        status: "failed",
        payer: input.verifyResult.payer,
        error: input.verifyResult.invalidReason ?? "verification_failed",
        facilitatorResult: input.verifyResult
      };
    }

    return {
      ...base,
      kind: "verified",
      status: "verified",
      payer: input.verifyResult.payer,
      facilitatorResult: input.verifyResult
    };
  }

  throw new PaymentEvidenceError("Payment evidence is missing facilitator result");
}

export function buildEvidenceFromHttpContext(input: {
  context: HTTPRequestContext;
  requirements: PaymentRequirements;
  paymentPayload?: PaymentPayload;
  verifyResult?: VerifyResponse;
  settleResult?: SettleResponse;
  failure?: string;
}) {
  const req = requestFromHttpContext(input.context);
  if (!req) {
    throw new PaymentEvidenceError("Payment evidence is missing request context");
  }

  return buildEvidenceFromRequirements({
    req,
    requirements: input.requirements,
    paymentPayload: input.paymentPayload,
    verifyResult: input.verifyResult,
    settleResult: input.settleResult,
    failure: input.failure
  });
}

export function requestFromHttpContext(context: HTTPRequestContext) {
  return (context.adapter as ExpressBackedAdapter).req;
}

export function buildDemoPaymentEvidence(req: Request): DemoPaymentEvidence {
  const mode = routeModeFromPath(req.path);
  const providerId = getProviderFromRequest(req);
  if (!mode || typeof providerId !== "string") {
    throw new PaymentEvidenceError("Payment evidence does not match request");
  }

  const amountUsd = expectedProviderPrice(providerId, mode);
  return {
    kind: "demo",
    status: "demo-paid",
    mode,
    endpoint: req.path,
    providerId,
    amountUsd,
    network: config.STELLAR_NETWORK,
    payTo: config.X402_PAY_TO_ADDRESS,
    facilitatorUrl: config.X402_FACILITATOR_URL,
    payer: req.header("x-demo-payer") ?? "demo-agent"
  };
}

export function setPaymentEvidence(req: Request, evidence: PaymentEvidence) {
  assertRequestMatchesEvidence(req, evidence);
  (req as EvidenceRequest).paymentEvidence = evidence;
}

export function getPaymentEvidence(req: Request) {
  return (req as EvidenceRequest).paymentEvidence;
}

export function setPaidRequestRecord(req: Request, record: PaidRequestRecord) {
  (req as EvidenceRequest).paidRequestRecord = record;
}

export function getPaidRequestRecord(req: Request) {
  return (req as EvidenceRequest).paidRequestRecord;
}

function toJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export async function persistPaymentEvidence(
  evidence: PaymentEvidence,
  record?: PaidRequestRecord
) {
  assertPriceMatchesProvider(evidence);
  const now = new Date().toISOString();
  const payment: PaymentAttempt = {
    id: `pay_${nanoid(10)}`,
    endpoint: evidence.endpoint,
    providerId: evidence.providerId,
    amountUsd: evidence.amountUsd,
    network: evidence.network,
    asset: evidence.asset,
    amount: evidence.amount,
    evidenceKind: evidence.kind,
    payerPublicKey: evidence.payer,
    payToAddress: evidence.payTo,
    facilitatorUrl: evidence.facilitatorUrl,
    status: evidence.status,
    transactionHash: evidence.kind === "settled" ? evidence.transactionHash : undefined,
    facilitatorResult:
      "facilitatorResult" in evidence ? toJsonRecord(evidence.facilitatorResult) : undefined,
    error: evidence.kind === "failed" ? evidence.error : undefined,
    createdAt: now
  };

  if (record) {
    const usage: UsageEvent = {
      id: `use_${nanoid(10)}`,
      mode: record.mode,
      endpoint: record.endpoint,
      providerId: record.providerId,
      queryOrUrl: record.queryOrUrl,
      priceUsd: record.priceUsd,
      network: evidence.network,
      paymentStatus: evidence.status,
      paymentKind: evidence.kind,
      paymentTxHash: evidence.kind === "settled" ? evidence.transactionHash : undefined,
      asset: evidence.asset,
      amount: evidence.amount,
      payToAddress: evidence.payTo,
      facilitatorUrl: evidence.facilitatorUrl,
      payerPublicKey: evidence.payer,
      traceId: record.traceId,
      createdAt: now,
      latencyMs: record.latencyMs
    };

    await persistPaymentAndUsage({ payment, usage });
    return;
  }

  await savePaymentAttempt(payment);
}

export function paymentEvidenceSummary(evidence: PaymentEvidence) {
  return {
    kind: evidence.kind,
    status: evidence.status,
    network: evidence.network,
    asset: evidence.asset,
    amount: evidence.amount,
    payTo: evidence.payTo,
    facilitatorUrl: evidence.facilitatorUrl,
    payer: evidence.payer,
    transactionHash: evidence.kind === "settled" ? evidence.transactionHash : undefined,
    proofLinks: buildPaymentProofLinks({
      transactionHash: evidence.kind === "settled" ? evidence.transactionHash : undefined,
      payerPublicKey: evidence.payer,
      payToAddress: evidence.payTo,
      network: evidence.network,
      asset: evidence.asset
    })
  };
}

export function requirePaymentEvidence(req: Request, res: Response, next: NextFunction) {
  try {
    const evidence = getPaymentEvidence(req);
    if (!evidence) {
      throw new PaymentEvidenceError("Payment evidence is missing");
    }
    assertRequestMatchesEvidence(req, evidence);
    return next();
  } catch (error) {
    return next(error);
  }
}
