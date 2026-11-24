import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createInMemoryStorageRepository } from "./storage/memory.js";
import { getStorageRepository, setStorageRepository } from "./storage/index.js";
import { buildPaidQueryFixture, buildTestUsageEvent } from "../test/storage-test-helpers.js";

vi.mock("./config.js", () => ({
  config: {
    STELLAR_NETWORK: "stellar:testnet",
    X402_PAY_TO_ADDRESS: "GA-test-address",
    X402_FACILITATOR_URL: "https://test.facilitator.url",
    DEMO_CLIENT_PUBLIC_KEY: "GA-demo-key"
  },
  requirePayToAddress: () => "GA-test-address"
}));

describe("persistPaidRequest price outlier detection", () => {
  beforeEach(() => {
    const repo = createInMemoryStorageRepository();
    setStorageRepository(repo);
  });

  afterEach(() => {
    const repo = getStorageRepository();
    if (repo && "close" in repo) {
      (repo as { close: () => void }).close();
    }
  });

  it("does not flag normal provider price as outlier", async () => {
    const { persistPaidRequest, getAnalyticsSummary } = await import("./persistence.js");

    await persistPaidRequest({
      mode: "search",
      endpoint: "/x402/search",
      provider: "search.basic",
      queryOrUrl: "normal price query",
      priceUsd: 0.01,
      latencyMs: 100,
      traceId: "trace_normal",
      paymentResponseHeader: "tx_normal",
      execution: {
        providerId: "search.basic",
        source: "deterministic-fallback",
        usedFallback: false,
        latencyEstimateMs: 700,
        observedDurationMs: 100
      }
    });

    const summary = await getAnalyticsSummary();
    expect(summary.recentUsage).toHaveLength(1);
    expect(summary.recentUsage[0].priceOutlier).toBeUndefined();
    expect(summary.recentUsage[0].priceOutlierReason).toBeUndefined();
  });

  it("flags expensive paid query as price outlier", async () => {
    const { persistPaidRequest, getAnalyticsSummary } = await import("./persistence.js");

    await persistPaidRequest({
      mode: "search",
      endpoint: "/x402/search",
      provider: "search.basic",
      queryOrUrl: "expensive query",
      priceUsd: 0.05,
      latencyMs: 150,
      traceId: "trace_outlier",
      paymentResponseHeader: "tx_outlier",
      execution: {
        providerId: "search.basic",
        source: "deterministic-fallback",
        usedFallback: false,
        latencyEstimateMs: 700,
        observedDurationMs: 150
      }
    });

    const summary = await getAnalyticsSummary();
    expect(summary.recentUsage).toHaveLength(1);
    expect(summary.recentUsage[0].priceOutlier).toBe(true);
    expect(summary.recentUsage[0].priceOutlierReason).toContain("exceeds configured price");
  });
});

describe("analytics privacy persistence gate (memory store)", () => {
  beforeEach(() => {
    const repo = createInMemoryStorageRepository();
    setStorageRepository(repo);
  });

  afterEach(() => {
    const repo = getStorageRepository();
    if (repo && "close" in repo) {
      (repo as { close: () => void }).close();
    }
  });

  it("stores a fixture event without query text", async () => {
    const { saveUsageEvent, getUsageEvents } = await import("./persistence.js");
    const { usage } = buildPaidQueryFixture({
      usage: { queryOrUrl: "fixture: paid search query with secrets" }
    });

    await saveUsageEvent(usage);

    const stored = await getUsageEvents();
    expect(stored).toHaveLength(1);
    expect(stored[0].queryOrUrl).toBe("");
    expect(JSON.stringify(stored[0])).not.toContain("fixture: paid search query with secrets");
    expect(stored[0].providerId).toBe("search.basic");
    expect(stored[0].paymentStatus).toBe("settled");
  });

  it("stores a fixture without payment headers", async () => {
    const { saveUsageEvent, getUsageEvents } = await import("./persistence.js");
    const paymentHeaderValue = "eyJhbGciOiJIUzI1NiJ9.payment-fixture-secret";
    const event = {
      ...buildTestUsageEvent({ queryOrUrl: "paid query text" }),
      headers: {
        payment: paymentHeaderValue,
        "payment-response": "payment-response-fixture-secret",
        "x-request-id": "req_fixture"
      },
      paymentResponseHeader: paymentHeaderValue
    };

    await saveUsageEvent(event);

    const stored = await getUsageEvents();
    expect(stored).toHaveLength(1);
    const blob = JSON.stringify(stored[0]);
    expect(blob).not.toContain(paymentHeaderValue);
    expect(blob).not.toContain("payment-response-fixture-secret");
    expect(blob).not.toContain("paid query text");
    expect(stored[0]).not.toHaveProperty("paymentResponseHeader");
    expect((stored[0] as { headers?: Record<string, string> }).headers?.payment).toBeUndefined();
  });

  it("does not store an event the privacy helper cannot redact", async () => {
    const { saveUsageEvent, getUsageEvents } = await import("./persistence.js");
    const event = {
      ...buildTestUsageEvent({ queryOrUrl: "should not land in storage" }),
      rawPaymentSecret: "unredactable-secret-value"
    };

    await saveUsageEvent(event);

    const stored = await getUsageEvents();
    expect(stored).toHaveLength(0);
  });

  it("rejects persistPaymentAndUsage when usage cannot be redacted", async () => {
    const { persistPaymentAndUsage, getUsageEvents, getPaymentAttempts } = await import(
      "./persistence.js"
    );
    const fixture = buildPaidQueryFixture();
    await persistPaymentAndUsage({
      payment: fixture.payment,
      usage: {
        ...fixture.usage,
        rawPaymentSecret: "still-unredactable"
      } as typeof fixture.usage & { rawPaymentSecret: string }
    });

    expect(await getUsageEvents()).toHaveLength(0);
    expect(await getPaymentAttempts()).toHaveLength(0);
  });
});
