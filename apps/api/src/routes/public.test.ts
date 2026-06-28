import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestUsageEvent } from "../test/storage-test-helpers.js";
import { applyApiTestEnv, resetApiTestStorage } from "../test/api-test-helpers.js";

describe("public routes", () => {
  let analyticsDbPath: string;

  beforeEach(() => {
    ({ analyticsDbPath } = applyApiTestEnv());
  });

  afterEach(async () => {
    await resetApiTestStorage(analyticsDbPath);
    vi.restoreAllMocks();
  });

  async function createPublicApp() {
    const { publicRouter } = await import("../routes/public.js");
    const app = express();
    app.use(publicRouter);
    return app;
  }

  it("returns health metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T10:00:00.000Z"));

    try {
      const app = await createPublicApp();
      const response = await request(app).get("/health");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        service: "query402-api",
        version: "0.1.0",
        nodeEnv: "test",
        network: "stellar:testnet",
        timestamp: "2026-06-21T10:00:00.000Z"
      });
      expect(typeof response.body.sponsorshipEnabled).toBe("boolean");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns provider catalog and category groupings", async () => {
    const app = await createPublicApp();

    const providersResponse = await request(app).get("/api/providers");
    const catalogResponse = await request(app).get("/api/catalog");

    expect(providersResponse.status).toBe(200);
    expect(
      providersResponse.body.providers.some(
        (provider: { id: string }) => provider.id === "search.basic"
      )
    ).toBe(true);

    expect(catalogResponse.status).toBe(200);
    expect(catalogResponse.body.providerCount).toBeGreaterThan(0);
    expect(catalogResponse.body.byCategory.search.length).toBeGreaterThan(0);
    expect(catalogResponse.body.byCategory.news.length).toBeGreaterThan(0);
    expect(catalogResponse.body.byCategory.scrape.length).toBeGreaterThan(0);
  });

  it("returns safe default analytics shape for fresh storage", async () => {
    const app = await createPublicApp();

    const analyticsResponse = await request(app).get("/api/analytics");

    expect(analyticsResponse.status).toBe(200);
    expect(analyticsResponse.body).toMatchObject({
      totalQueries: 0,
      totalSpendUsd: 0,
      spendByCategory: {
        search: 0,
        news: 0,
        scrape: 0
      },
      recentUsage: [],
      recentTransactions: []
    });
  });

  it("returns usage and analytics summaries from isolated sqlite storage", async () => {
    const app = await createPublicApp();
    const { saveUsageEvent } = await import("../lib/persistence.js");

    await saveUsageEvent(
      buildTestUsageEvent({
        id: "use_test_1",
        queryOrUrl: "stellar x402",
        paymentStatus: "demo-paid",
        traceId: "trace_test_1",
        createdAt: "2026-06-21T10:00:00.000Z",
        latencyMs: 12
      })
    );

    const usageResponse = await request(app).get("/api/usage");
    const analyticsResponse = await request(app).get("/api/analytics");

    expect(usageResponse.status).toBe(200);
    expect(usageResponse.body.usage).toHaveLength(1);
    expect(usageResponse.body.pagination).toMatchObject({
      count: 1,
      offset: 0
    });

    expect(analyticsResponse.status).toBe(200);
    expect(analyticsResponse.body.totalQueries).toBe(1);
    expect(analyticsResponse.body.totalSpendUsd).toBe(0.01);
    expect(analyticsResponse.body.spendByCategory.search).toBe(0.01);
  });
});
