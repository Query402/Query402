import fs from "node:fs";
import path from "node:path";
import type {
  AnalyticsSummary,
  PaymentAttempt,
  UsageEvent,
  PrivacySafeAnalyticsResponse,
  DetailedAnalyticsResponse
} from "@query402/shared";
import { getPublicAnalytics, getDetailedAnalytics, getAnalyticsConfig } from "./analytics-service.js";

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
  overrides: Partial<UsageEvent> = {}
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
    paymentId,
    createdAt: now,
    latencyMs: input.latencyMs,
    execution: input.execution,
    ...computePriceOutlier(input.provider, input.priceUsd),
    ...overrides
  };
}

export async function saveUsageEvent(event: UsageEvent): Promise<void> {
  await getStorageRepository().saveUsageEvent(event);
}

export async function savePaymentAttempt(payment: PaymentAttempt): Promise<void> {
  await getStorageRepository().savePaymentAttempt(payment);
}

export async function persistPaymentAndUsage(pair: PaymentUsagePair): Promise<void> {
  await getStorageRepository().persistPaymentAndUsage(pair);
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
  const usage = buildUsageEvent(input, {
    payerPublicKey: input.payerPublicKey
  });

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
    sponsorshipFields
  );

  await persistPaymentAndUsage({ payment, usage });
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
