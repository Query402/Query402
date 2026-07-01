import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createInMemoryStorageRepository } from "./storage/memory.js";
import { getStorageRepository, setStorageRepository } from "./storage/index.js";

vi.mock("./config.js", () => ({
  config: {
    STELLAR_NETWORK: "stellar:testnet",
    X402_PAY_TO_ADDRESS: "GA-test-address",
    X402_FACILITATOR_URL: "https://test.facilitator.url",
    DEMO_CLIENT_PUBLIC_KEY: "GA-demo-key"
  }
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
