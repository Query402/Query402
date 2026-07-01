import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyApiTestEnv, resetApiTestStorage, TEST_WALLET } from "../test/api-test-helpers.js";

const executeQueryMock = vi.fn();

vi.mock("../services/query-service.js", () => ({
  executeQuery: (...args: unknown[]) => executeQueryMock(...args)
}));

function mockQueryResult(mode: "search" | "news" | "scrape", providerId: string, priceUsd: number) {
  executeQueryMock.mockResolvedValueOnce({
    mode,
    providerId,
    providerName: providerId,
    priceUsd,
    latencyMs: 10,
    timestamp: "2026-06-21T10:00:00.000Z",
    traceId: `trace_${providerId}`,
    items: [],
    source: "deterministic-fallback",
    execution: {
      providerId,
      source: "deterministic-fallback",
      usedFallback: true,
      fallbackReason: "deterministic-provider",
      latencyEstimateMs: 700,
      observedDurationMs: 10,
      circuitBreakerState: "closed"
    }
  });
}

async function createDemoApp() {
  const { createX402Middleware } = await import("../lib/x402.js");
  const { protectedRouter } = await import("../routes/protected.js");
  const app = express();
  app.use(createX402Middleware());
  app.use(protectedRouter);
  return app;
}

describe("demo-mode x402 flow", () => {
  let analyticsDbPath: string;
  let sponsorshipDbPath: string;

  beforeEach(() => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv());
    executeQueryMock.mockReset();
  });

  afterEach(async () => {
    await resetApiTestStorage(analyticsDbPath, sponsorshipDbPath);
    vi.restoreAllMocks();
  });

  it("returns a 402 challenge without live credentials", async () => {
    const app = await createDemoApp();

    const response = await request(app)
      .get("/x402/search")
      .query({ provider: "search.basic", q: "stellar x402" });

    expect(response.status).toBe(402);
    expect(response.body).toMatchObject({
      error: "Payment Required",
      demoMode: true,
      accepts: {
        scheme: "exact",
        network: "stellar:testnet",
        price: "$0.01",
        payTo: TEST_WALLET
      }
    });
    expect(executeQueryMock).not.toHaveBeenCalled();
  });

  it("executes a paid retry with demo headers and provider-specific pricing", async () => {
    const app = await createDemoApp();
    mockQueryResult("search", "search.pro", 0.02);

    const response = await request(app)
      .get("/x402/search")
      .query({ provider: "search.pro", q: "stellar x402" })
      .set("x-query402-demo-paid", "true")
      .set("x-demo-payer", TEST_WALLET)
      .set("payment-response", "demo-proof-123");

    expect(response.status).toBe(200);
    expect(response.body.traceId).toBe(response.body.result.traceId);
    expect(response.body.result.priceUsd).toBe(0.02);
    expect(response.body.payment.evidence).toMatchObject({
      kind: "demo",
      status: "demo-paid"
    });
    expect(executeQueryMock).toHaveBeenCalledTimes(1);
  });

  it("uses dynamic pricing for news and scrape paid retries", async () => {
    const app = await createDemoApp();
    mockQueryResult("news", "news.deep", 0.03);
    mockQueryResult("scrape", "scrape.extract", 0.04);

    const newsResponse = await request(app)
      .get("/x402/news")
      .query({ provider: "news.deep", q: "micropayments" })
      .set("x-query402-demo-paid", "true")
      .set("x-demo-payer", TEST_WALLET)
      .set("payment-response", "demo-proof-news");

    const scrapeResponse = await request(app)
      .get("/x402/scrape")
      .query({ provider: "scrape.extract", url: "https://example.com/docs" })
      .set("x-query402-demo-paid", "true")
      .set("x-demo-payer", TEST_WALLET)
      .set("payment-response", "demo-proof-scrape");

    expect(newsResponse.status).toBe(200);
    expect(newsResponse.body.result.priceUsd).toBe(0.03);
    expect(scrapeResponse.status).toBe(200);
    expect(scrapeResponse.body.result.priceUsd).toBe(0.04);
  });
});
