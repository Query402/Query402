import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type {
  AnalyticsSummary,
  PaymentAttempt,
  UsageEvent,
  PrivacySafeAnalyticsResponse,
  DetailedAnalyticsResponse,
  QueryMode,
  PaymentSource,
  ProviderExecutionMetadata,
  SettlementDigest
} from "@query402/shared";
import type {
  PaginationOptions,
  AnalyticsQueryOptions,
  PaymentUsagePair
} from "./storage/types.js";
import { getStorageRepository } from "./storage/index.js";
import {
  getPublicAnalytics,
  getDetailedAnalytics,
  getAnalyticsConfig
} from "./analytics-service.js";
import { getProviderById } from "./pricing.js";
import { config, requirePayToAddress } from "./config.js";
import {
  sanitizeAnalyticsEventForStorage,
  sanitizePaymentAttemptForStorage
} from "./analytics-privacy.js";

export interface PersistPaidRequestInput {
  mode: QueryMode;
  endpoint: string;
  provider: string;
  queryOrUrl: string;
  priceUsd: number;
  latencyMs: number;
  traceId: string;
  paymentResponseHeader: string | null;
  execution: ProviderExecutionMetadata;
  payerPublicKey?: string;
  errorCode?: string;
}

export interface PersistSponsoredPaymentInput extends PersistPaidRequestInput {
  walletPublicKey: string;
  sponsorshipGrantId: string;
  policyDecision: string;
  paymentSource?: PaymentSource;
  sponsorPublicKey?: string;
}

function buildPaymentAttempt(
  input: PersistPaidRequestInput,
  overrides: Partial<PaymentAttempt> = {}
): PaymentAttempt {
  const now = new Date().toISOString();

  return {
    id: `pay_${nanoid(10)}`,
    endpoint: input.endpoint,
    providerId: input.provider,
    amountUsd: input.priceUsd,
    network: config.STELLAR_NETWORK,
    payerPublicKey: input.payerPublicKey,
    payToAddress: requirePayToAddress(),
    facilitatorUrl: config.X402_FACILITATOR_URL,
    status: "settled",
    transactionHash: input.paymentResponseHeader ?? undefined,
    errorCode: input.errorCode as any,
    createdAt: now,
    ...overrides
  };
}

function computePriceOutlier(
  providerId: string,
  priceUsd: number
): Partial<Pick<UsageEvent, "priceOutlier" | "priceOutlierReason">> {
  const provider = getProviderById(providerId);
  if (!provider) return {};

  const threshold = provider.priceUsd * 1.1;
  if (priceUsd > threshold) {
    return {
      priceOutlier: true,
      priceOutlierReason: `Price $${priceUsd.toFixed(4)} exceeds configured price $${provider.priceUsd.toFixed(4)} for provider ${providerId}`
    };
  }
  return {};
}

function buildUsageEvent(
  input: PersistPaidRequestInput,
  overrides: Partial<UsageEvent> = {},
  paymentIdOverride?: string
): UsageEvent {
  const now = new Date().toISOString();

  return {
    id: `use_${nanoid(10)}`,
    mode: input.mode,
    endpoint: input.endpoint,
    providerId: input.provider,
    queryOrUrl: input.queryOrUrl,
    priceUsd: input.priceUsd,
    network: config.STELLAR_NETWORK,
    paymentStatus: "settled",
    paymentTxHash: input.paymentResponseHeader ?? undefined,
    facilitatorUrl: config.X402_FACILITATOR_URL,
    payerPublicKey: input.payerPublicKey,
    traceId: input.traceId,
    paymentId: paymentIdOverride,
    createdAt: now,
    latencyMs: input.latencyMs,
    execution: input.execution,
    ...computePriceOutlier(input.provider, input.priceUsd),
    ...overrides
  };
}

export async function saveUsageEvent(event: UsageEvent): Promise<void> {
  const sanitized = sanitizeAnalyticsEventForStorage(event);
  if (!sanitized.ok) {
    // Reject writes the privacy helper cannot redact.
    return;
  }
  await getStorageRepository().saveUsageEvent(sanitized.value);
}

export async function savePaymentAttempt(payment: PaymentAttempt): Promise<void> {
  const sanitized = sanitizePaymentAttemptForStorage(payment);
  if (!sanitized.ok) {
    return;
  }
  await getStorageRepository().savePaymentAttempt(sanitized.value);
}

export async function persistPaymentAndUsage(pair: PaymentUsagePair): Promise<void> {
  const usage = sanitizeAnalyticsEventForStorage(pair.usage);
  if (!usage.ok) {
    return;
  }
  const payment = sanitizePaymentAttemptForStorage(pair.payment);
  if (!payment.ok) {
    return;
  }
  await getStorageRepository().persistPaymentAndUsage({
    payment: payment.value,
    usage: usage.value
  });
}

export async function getUsageEvents(options?: PaginationOptions): Promise<UsageEvent[]> {
  return getStorageRepository().getUsageEvents(options);
}

export async function getPaymentAttempts(options?: PaginationOptions): Promise<PaymentAttempt[]> {
  return getStorageRepository().getPaymentAttempts(options);
}

export async function getAnalyticsSummary(
  options?: AnalyticsQueryOptions
): Promise<AnalyticsSummary> {
  return getStorageRepository().getAnalyticsSummary(options);
}

export async function getSettlementDigest(): Promise<SettlementDigest> {
  return getStorageRepository().getSettlementDigest();
}

export async function persistPaidRequest(input: PersistPaidRequestInput): Promise<void> {
  const payment = buildPaymentAttempt(input);
  const usage = buildUsageEvent(
    input,
    {
      payerPublicKey: input.payerPublicKey
    },
    payment.id
  );

  await persistPaymentAndUsage({ payment, usage });
}

export async function persistSponsoredPayment(input: PersistSponsoredPaymentInput): Promise<void> {
  const paymentSource = input.paymentSource ?? "sponsored";
  const sponsorPublicKey = input.sponsorPublicKey ?? config.DEMO_CLIENT_PUBLIC_KEY;
  const sponsorshipFields = {
    sponsorshipGrantId: input.sponsorshipGrantId,
    policyDecision: input.policyDecision,
    paymentSource,
    sponsorPublicKey
  };

  const payment = buildPaymentAttempt(
    { ...input, payerPublicKey: input.walletPublicKey },
    sponsorshipFields
  );
  const usage = buildUsageEvent(
    { ...input, payerPublicKey: input.walletPublicKey },
    sponsorshipFields,
    payment.id
  );

  await persistPaymentAndUsage({ payment, usage });
}

export async function updatePaymentAttemptEvidence(
  paymentId: string,
  evidenceUpdates: Partial<PaymentAttempt["evidence"]>
): Promise<void> {
  const repo = getStorageRepository();
  if ("updatePaymentAttempt" in repo && typeof repo.updatePaymentAttempt === "function") {
    await repo.updatePaymentAttempt(paymentId, evidenceUpdates);
  }
}

export async function updateUsageEventsByPaymentId(
  paymentId: string,
  evidenceUpdates: Partial<UsageEvent["paymentEvidence"]>
): Promise<void> {
  const repo = getStorageRepository();
  if ("updateUsageByPaymentId" in repo && typeof repo.updateUsageByPaymentId === "function") {
    await repo.updateUsageByPaymentId(paymentId, evidenceUpdates);
  }
}

function readDb(): { usage: UsageEvent[]; payments: PaymentAttempt[] } {
  return {
    usage: [],
    payments: []
  };
}

/**
 * Get public analytics - privacy-safe, paginated, no sensitive data
 */
export function getPublicAnalyticsData(
  cursor?: string,
  limit?: number
): PrivacySafeAnalyticsResponse {
  const db = readDb();
  return getPublicAnalytics(db.usage, db.payments, { cursor, limit });
}

/**
 * Get detailed analytics - for authorized endpoints only
 * Still redacts sensitive fields but includes more data
 */
export function getDetailedAnalyticsData(
  cursor?: string,
  limit?: number
): DetailedAnalyticsResponse {
  const db = readDb();
  return getDetailedAnalytics(db.usage, db.payments, { cursor, limit });
}
