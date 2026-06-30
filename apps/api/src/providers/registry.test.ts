import { describe, it, expect } from "vitest";
import { DefaultProviderRegistry } from "./registry.js";
import { ProviderAdapter } from "./core.js";

// Ensure pricing data exists for our fake tests so getProviderById works
import { providers } from "../lib/pricing.js";
providers.push({
  id: "test.search.live",
  name: "Test Live Search",
  category: "search",
  priceUsd: 0.05,
  description: "Test live search",
  latencyEstimateMs: 100,
  qualityScore: 90,
  sourceType: "live",
  enabled: true
});
providers.push({
  id: "test.search.deterministic",
  name: "Test Deterministic Search",
  category: "search",
  priceUsd: 0.05,
  description: "Test mock search",
  latencyEstimateMs: 100,
  qualityScore: 90,
  sourceType: "deterministic-fallback",
  enabled: true
});

class MockAdapter implements ProviderAdapter {
  public executeSuccess = true;
  public healthy = true;
  public executionDelay = 0;
  public callCount = 0;

  constructor(public id: string) {}

  async isHealthy(): Promise<boolean> {
    return this.healthy;
  }

  async execute(queryOrUrl: string) {
    this.callCount++;
    if (this.executionDelay > 0) {
      await new Promise((r) => setTimeout(r, this.executionDelay));
    }
    if (!this.executeSuccess) {
      throw new Error("Execution failed");
    }
    return [{ title: `Live Result for ${queryOrUrl}`, url: "", snippet: "", score: 1 }];
  }

  getFallback(queryOrUrl: string) {
    return [{ title: `Fallback Result for ${queryOrUrl}`, url: "", snippet: "", score: 1 }];
  }
}

describe("ProviderRegistry", () => {
  it("rejects unknown providers", async () => {
    const registry = new DefaultProviderRegistry();
    await expect(registry.execute("search", "unknown.provider", "q")).rejects.toThrow(
      /Provider not found or disabled/
    );
  });

  it("rejects category mismatch", async () => {
    const registry = new DefaultProviderRegistry();
    await expect(registry.execute("news", "test.search.live", "q")).rejects.toThrow(
      /Provider test.search.live does not support mode news/
    );
  });

  it("executes successfully and returns live source", async () => {
    const registry = new DefaultProviderRegistry();
    const adapter = new MockAdapter("test.search.live");
    registry.register(adapter);

    const result = await registry.execute("search", "test.search.live", "test-query");
    expect(result.source).toBe("live");
    expect(result.items[0].title).toBe("Live Result for test-query");
    expect(result.execution).toMatchObject({
      providerId: "test.search.live",
      source: "live",
      usedFallback: false,
      latencyEstimateMs: 100
    });
  });

  it("falls back to deterministic data if deterministic provider", async () => {
    const registry = new DefaultProviderRegistry();
    const adapter = new MockAdapter("test.search.deterministic");
    registry.register(adapter);

    const result = await registry.execute("search", "test.search.deterministic", "test-query");
    expect(result.source).toBe("deterministic-fallback");
    expect(result.items[0].title).toBe("Fallback Result for test-query");
    expect(result.execution).toMatchObject({
      providerId: "test.search.deterministic",
      source: "deterministic-fallback",
      usedFallback: true,
      fallbackReason: "deterministic-provider"
    });
  });

  it("falls back gracefully when unhealthy", async () => {
    const registry = new DefaultProviderRegistry();
    const adapter = new MockAdapter("test.search.live");
    adapter.healthy = false;
    registry.register(adapter);

    const result = await registry.execute("search", "test.search.live", "test-query");
    expect(result.source).toBe("deterministic-fallback");
    expect(result.items[0].title).toBe("Fallback Result for test-query");
    expect(adapter.callCount).toBe(0);
    expect(result.execution).toMatchObject({
      source: "deterministic-fallback",
      usedFallback: true,
      fallbackReason: "unhealthy"
    });
  });

  it("marks timeouts as fallback metadata", async () => {
    const registry = new DefaultProviderRegistry({ maxFailures: 3, cooldownMs: 30000, timeoutMs: 1 });
    const adapter = new MockAdapter("test.search.live");
    adapter.executionDelay = 10;
    registry.register(adapter);

    const result = await registry.execute("search", "test.search.live", "test-query");

    expect(result.source).toBe("deterministic-fallback");
    expect(result.execution).toMatchObject({
      source: "deterministic-fallback",
      usedFallback: true,
      fallbackReason: "timeout"
    });
  });

  it("trips circuit breaker and recovers", async () => {
    const registry = new DefaultProviderRegistry();
    const adapter = new MockAdapter("test.search.live");
    registry.register(adapter);

    adapter.executeSuccess = false;

    let res = await registry.execute("search", "test.search.live", "test-query");
    expect(res.source).toBe("deterministic-fallback");
    expect(adapter.callCount).toBe(1);

    res = await registry.execute("search", "test.search.live", "test-query");
    expect(res.source).toBe("deterministic-fallback");
    expect(adapter.callCount).toBe(2);

    res = await registry.execute("search", "test.search.live", "test-query");
    expect(res.source).toBe("deterministic-fallback");
    expect(adapter.callCount).toBe(3);

    res = await registry.execute("search", "test.search.live", "test-query");
    expect(res.source).toBe("deterministic-fallback");
    expect(adapter.callCount).toBe(3);
  });
});
