import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { PaymentAttempt, UsageEvent } from "@query402/shared";

export interface PaidQueryFixture {
  payment: PaymentAttempt;
  usage: UsageEvent;
}

const FIXTURE_PAY_TO = `G${"D".repeat(55)}`;
const FIXTURE_PAYER = `G${"E".repeat(55)}`;
const FIXTURE_TX_HASH = "a".repeat(64);

export function createTempAnalyticsDbPath(): string {
  return `/tmp/query402-analytics-${randomUUID()}.db`;
}

export function createTempJsonPath(): string {
  return `/tmp/query402-legacy-${randomUUID()}.json`;
}

export async function resetAnalyticsStore(dbPath?: string): Promise<void> {
  const { closeAnalyticsDb } = await import("../lib/storage/sqlite/store.js");
  closeAnalyticsDb();

  if (dbPath && fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { force: true });
  }
}

export function buildTestUsageEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  const suffix = randomUUID().slice(0, 8);
  const providerId = overrides.providerId ?? "search.basic";

  return {
    id: `use_${suffix}`,
    mode: "search",
    endpoint: "/x402/search",
    providerId,
    queryOrUrl: "test query",
    priceUsd: 0.01,
    network: "stellar:testnet",
    paymentStatus: "settled",
    facilitatorUrl: "https://channels.openzeppelin.com/x402/testnet",
    traceId: `trace_${suffix}`,
    createdAt: new Date().toISOString(),
    latencyMs: 100,
    execution: {
      providerId,
      source: "deterministic-fallback",
      usedFallback: true,
      fallbackReason: "deterministic-provider",
      latencyEstimateMs: 700,
      observedDurationMs: 100,
      circuitBreakerState: "closed"
    },
    ...overrides
  };
}

export function buildTestPaymentAttempt(overrides: Partial<PaymentAttempt> = {}): PaymentAttempt {
  const suffix = randomUUID().slice(0, 8);

  return {
    id: `pay_${suffix}`,
    endpoint: "/x402/search",
    providerId: "search.basic",
    amountUsd: 0.01,
    network: "stellar:testnet",
    payToAddress: `G${"C".repeat(55)}`,
    facilitatorUrl: "https://channels.openzeppelin.com/x402/testnet",
    status: "settled",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

export function buildPaidQueryFixture(overrides: {
  payment?: Partial<PaymentAttempt>;
  usage?: Partial<UsageEvent>;
} = {}): PaidQueryFixture {
  const payment: PaymentAttempt = {
    id: "pay_fixture_0001",
    endpoint: "/x402/search",
    providerId: "search.basic",
    amountUsd: 0.01,
    network: "stellar:testnet",
    asset: "USDC:testnet",
    amount: "10000",
    evidenceKind: "settled",
    payerPublicKey: FIXTURE_PAYER,
    payToAddress: FIXTURE_PAY_TO,
    facilitatorUrl: "https://channels.openzeppelin.com/x402/testnet",
    status: "settled",
    transactionHash: FIXTURE_TX_HASH,
    createdAt: "2026-06-30T12:00:00.000Z",
    ...overrides.payment
  };

  const usage: UsageEvent = {
    id: "use_fixture_0001",
    mode: "search",
    endpoint: "/x402/search",
    providerId: "search.basic",
    queryOrUrl: "fixture: paid search query",
    priceUsd: 0.01,
    network: "stellar:testnet",
    paymentStatus: "settled",
    paymentKind: "settled",
    paymentTxHash: FIXTURE_TX_HASH,
    asset: "USDC:testnet",
    amount: "10000",
    payToAddress: FIXTURE_PAY_TO,
    facilitatorUrl: "https://channels.openzeppelin.com/x402/testnet",
    payerPublicKey: FIXTURE_PAYER,
    traceId: "trace_fixture_0001",
    createdAt: "2026-06-30T12:00:00.000Z",
    latencyMs: 350,
    execution: {
      providerId: "search.basic",
      source: "live",
      usedFallback: false,
      latencyEstimateMs: 400,
      observedDurationMs: 350,
      circuitBreakerState: "closed"
    },
    ...overrides.usage
  };

  return { payment, usage };
}

export function buildLegacyDbFixture(): { usage: UsageEvent[]; payments: PaymentAttempt[] } {
  const usage = buildTestUsageEvent({ id: "use_legacy_1" });
  const payment = buildTestPaymentAttempt({
    id: "pay_legacy_1",
    transactionHash: "tx_legacy_1"
  });

  return { usage: [usage], payments: [payment] };
}
