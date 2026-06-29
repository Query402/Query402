import { nanoid } from "nanoid";
import type {
  AnalyticsSummary,
  PaymentAttempt,
  ProviderExecutionMetadata,
  PaymentSource,
  QueryMode,
  UsageEvent
} from "@query402/shared";
import { config } from "./config.js";
import { getStorageRepository } from "./storage/index.js";
import type {
  AnalyticsQueryOptions,
  PaginationOptions,
  PaymentUsagePair
} from "./storage/types.js";

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
    payToAddress: config.X402_PAY_TO_ADDRESS,
    facilitatorUrl: config.X402_FACILITATOR_URL,
    status: "settled",
    transactionHash: input.paymentResponseHeader ?? undefined,
    createdAt: now,
    ...overrides
  };
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
    createdAt: now,
    latencyMs: input.latencyMs,
    execution: input.execution,
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
