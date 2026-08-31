import express from "express";
import request from "supertest";
import { providerCapabilitySchema } from "@query402/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { persistPaymentAndUsage } from "../lib/persistence.js";
import { buildTestPaymentAttempt, buildTestUsageEvent } from "../test/storage-test-helpers.js";
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
      expect(typeof response.body.uptimeSeconds).toBe("number");
      expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns readiness metadata without sensitive values", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T10:00:00.000Z"));

    try {
      const app = await createPublicApp();
      const response = await request(app).get("/api/readiness");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        version: "0.1.0",
        timestamp: "2026-06-21T10:00:00.000Z",
        demoMode: true,
        network: "stellar:testnet",
        facilitatorConfigured: false,
        facilitatorSupported: false,
        storageAvailable: true
      });
      expect(typeof response.body.uptimeSeconds).toBe("number");
      expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(response.body.providersByMode).toMatchObject({
        live: 1,
        fallback: 6
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not expose secret config values in readiness response", async () => {
    const app = await createPublicApp();
    const response = await request(app).get("/api/readiness");

    expect(response.status).toBe(200);

    const bodyStr = JSON.stringify(response.body);
    expect(bodyStr).not.toContain("API_KEY");
    expect(bodyStr).not.toContain("SECRET");
    expect(bodyStr).not.toContain("PRIVATE");
    expect(bodyStr).not.toContain("BEARER");
    expect(bodyStr).not.toContain("token");
    expect(bodyStr).not.toMatch(/[A-Za-z0-9]{56}/);
  });

  it("returns readiness endpoint working in demo mode without live facilitator credentials", async () => {
    const app = await createPublicApp();

    const response = await request(app).get("/api/readiness");

    expect(response.status).toBe(200);
    expect(response.body.demoMode).toBe(true);
    expect(response.body.facilitatorConfigured).toBe(false);
    expect(response.body.facilitatorSupported).toBe(false);
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

  it("every provider in catalog has slaBadges with correct shape", async () => {
    const app = await createPublicApp();
    const catalogResponse = await request(app).get("/api/catalog");

    expect(catalogResponse.status).toBe(200);

    for (const provider of catalogResponse.body.providers) {
      expect(provider.slaBadges).toBeDefined();
      expect(["fast", "standard", "slow"]).toContain(provider.slaBadges.latencyBand);
      expect(["demo", "fallback", "live"]).toContain(provider.slaBadges.reliabilityBand);
      expect(["demo", "x402", "sponsored"]).toContain(provider.slaBadges.paymentMode);
      expect(typeof provider.slaBadges.latencyLabel).toBe("string");
      expect(provider.slaBadges.latencyLabel.length).toBeGreaterThan(0);
      expect(typeof provider.slaBadges.reliabilityLabel).toBe("string");
      expect(provider.slaBadges.reliabilityLabel.length).toBeGreaterThan(0);
      expect(typeof provider.slaBadges.paymentLabel).toBe("string");
      expect(provider.slaBadges.paymentLabel.length).toBeGreaterThan(0);
    }
  });

  it("providers endpoint also exposes slaBadges", async () => {
    const app = await createPublicApp();
    const providersResponse = await request(app).get("/api/providers");

    expect(providersResponse.status).toBe(200);
    const provider = providersResponse.body.providers.find(
      (p: { id: string }) => p.id === "search.basic"
    );
    expect(provider).toBeDefined();
    expect(provider.slaBadges).toBeDefined();
    expect(provider.slaBadges.latencyBand).toBe("fast");
    expect(provider.slaBadges.reliabilityBand).toBe("fallback");
    expect(provider.slaBadges.paymentMode).toBe("x402");
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
      executionSummary: {
        totalExecutions: 0,
        liveExecutions: 0,
        fallbackExecutions: 0,
        unavailableExecutions: 0,
        timeoutExecutions: 0,
        circuitOpenExecutions: 0
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

  describe("demo scenario manifest", () => {
    it("returns stable JSON with scenarios array", async () => {
      const app = await createPublicApp();
      const response = await request(app).get("/api/scenarios");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("scenarios");
      expect(Array.isArray(response.body.scenarios)).toBe(true);
      expect(response.body.scenarios.length).toBeGreaterThanOrEqual(3);
    });

    it("includes at least one scenario per mode (search, news, scrape)", async () => {
      const app = await createPublicApp();
      const response = await request(app).get("/api/scenarios");

      const modes = response.body.scenarios.map((s: { mode: string }) => s.mode);
      expect(modes).toContain("search");
      expect(modes).toContain("news");
      expect(modes).toContain("scrape");
    });

    it("each scenario has required shape", async () => {
      const app = await createPublicApp();
      const response = await request(app).get("/api/scenarios");

      for (const scenario of response.body.scenarios) {
        expect(scenario).toHaveProperty("id");
        expect(scenario).toHaveProperty("mode");
        expect(scenario).toHaveProperty("recommendedProvider");
        expect(scenario).toHaveProperty("sampleQuery");
        expect(scenario).toHaveProperty("expectedEvidenceFields");
        expect(Array.isArray(scenario.expectedEvidenceFields)).toBe(true);
        expect(scenario.expectedEvidenceFields.length).toBeGreaterThan(0);
        expect(scenario).toHaveProperty("worksInDemoMode");
        expect(scenario).toHaveProperty("worksInRealMode");
        expect(typeof scenario.worksInDemoMode).toBe("boolean");
        expect(typeof scenario.worksInRealMode).toBe("boolean");
      }
    });

    it("returns identical response on repeated calls (stable manifest)", async () => {
      const app = await createPublicApp();
      const first = await request(app).get("/api/scenarios");
      const second = await request(app).get("/api/scenarios");

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body).toEqual(second.body);
    });

    it("does not trigger any provider execution", async () => {
      const { providers } = await import("../lib/pricing.js");
      const { getCatalog } = await import("../services/query-service.js");

      const app = await createPublicApp();
      const response = await request(app).get("/api/scenarios");

      expect(response.status).toBe(200);
      const catalog = getCatalog();
      expect(catalog.providerCount).toBe(providers.length);
    });
  });

  describe("paid query fixture", () => {
    it("analytics reflects settled paid query from fixture", async () => {
      const { persistPaymentAndUsage } = await import("../lib/persistence.js");
      await persistPaymentAndUsage(buildPaidQueryFixture());

    const response = await request(app).get("/api/audit/digest");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      totalPaidRuns: 0,
      totalSettledAmountUsd: 0,
      settledAmountByAssetNetwork: {},
      withPaymentEvidence: 0,
      missingPaymentEvidence: 0,
      latestPaymentTimestamp: null
    });
    expect(response.body.generatedAt).toEqual(expect.any(String));
  });

  it("returns a populated settlement digest for recorded paid runs", async () => {
    const firstPayment = buildTestPaymentAttempt({
      id: "pay_001",
      amountUsd: 1.25,
      createdAt: "2026-06-21T10:00:00.000Z",
      transactionHash: "tx_001"
    });
    const firstUsage = buildTestUsageEvent({
      id: "use_001",
      createdAt: firstPayment.createdAt,
      paymentStatus: "settled"
    });

    const secondPayment = buildTestPaymentAttempt({
      id: "pay_002",
      amountUsd: 0.5,
      createdAt: "2026-06-21T10:05:00.000Z"
    });
    const secondUsage = buildTestUsageEvent({
      id: "use_002",
      createdAt: secondPayment.createdAt,
      paymentStatus: "settled"
    });

    await persistPaymentAndUsage({ payment: firstPayment, usage: firstUsage });
    await persistPaymentAndUsage({ payment: secondPayment, usage: secondUsage });

      expect(first.payment).toEqual(second.payment);
      expect(first.usage).toEqual(second.usage);
    });

    it("demo variant records correct payment markers via fixture overrides", async () => {
      const { persistPaymentAndUsage } = await import("../lib/persistence.js");
      await persistPaymentAndUsage(
        buildPaidQueryFixture({
          payment: {
            id: "pay_fixture_demo_01",
            status: "demo-paid",
            evidenceKind: "demo",
            transactionHash: undefined
          },
          usage: {
            id: "use_fixture_demo_01",
            paymentStatus: "demo-paid",
            paymentKind: "demo",
            paymentTxHash: undefined
          }
        })
      );

      const app = await createPublicApp();
      const analyticsResponse = await request(app).get("/api/analytics");

      expect(analyticsResponse.status).toBe(200);
      expect(analyticsResponse.body).toMatchObject({
        totalQueries: 1,
        demoSpendUsd: 0.01,
        settledSpendUsd: 0
      });

      const { recentUsage, recentTransactions } = analyticsResponse.body;
      expect(recentUsage[0]).toMatchObject({
        id: "use_fixture_demo_01",
        paymentStatus: "demo-paid",
        paymentKind: "demo"
      });
      expect(recentTransactions[0]).toMatchObject({
        id: "pay_fixture_demo_01",
        status: "demo-paid",
        evidenceKind: "demo"
      });
    });
    expect(response.body.generatedAt).toEqual(expect.any(String));
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
      executionSummary: {
        totalExecutions: 0,
        liveExecutions: 0,
        fallbackExecutions: 0,
        unavailableExecutions: 0,
        timeoutExecutions: 0,
        circuitOpenExecutions: 0
      },
      totalDemoQueries: 0,
      totalSettledPayments: 0,
      spendByPaymentSource: {},
      recentDemoActivity: [],
      recentSettledPayments: [],
      recentUsage: [],
      recentTransactions: []
    });
  });

  it("returns usage and analytics summaries from isolated sqlite storage", async () => {
    const app = await createPublicApp();
    const { persistPaymentAndUsage } = await import("../lib/persistence.js");
    const { buildTestPaymentAttempt } = await import("../test/storage-test-helpers.js");

    await persistPaymentAndUsage({
      payment: buildTestPaymentAttempt({
        id: "pay_demo_1",
        status: "demo-paid",
        paymentSource: "demo",
        amountUsd: 0.01
      }),
      usage: buildTestUsageEvent({
        id: "use_demo_1",
        queryOrUrl: "stellar x402",
        paymentStatus: "demo-paid",
        traceId: "trace_demo_1",
        createdAt: "2026-06-21T10:00:00.000Z",
        latencyMs: 12
      })
    });

    await persistPaymentAndUsage({
      payment: buildTestPaymentAttempt({
        id: "pay_settled_1",
        status: "settled",
        paymentSource: "wallet",
        amountUsd: 0.02
      }),
      usage: buildTestUsageEvent({
        id: "use_settled_1",
        queryOrUrl: "settled query",
        paymentStatus: "settled",
        traceId: "trace_settled_1",
        createdAt: "2026-06-21T11:00:00.000Z",
        latencyMs: 34
      })
    });

    const usageResponse = await request(app).get("/api/usage");
    const analyticsResponse = await request(app).get("/api/analytics");

    expect(usageResponse.status).toBe(200);
    expect(usageResponse.body.usage).toHaveLength(2);
    expect(usageResponse.body.pagination).toMatchObject({
      count: 2,
      offset: 0
    });

    expect(analyticsResponse.status).toBe(200);
    expect(analyticsResponse.body.totalQueries).toBe(2);
    expect(analyticsResponse.body.totalSpendUsd).toBe(0.02);
    expect(analyticsResponse.body.spendByCategory.search).toBe(0.02);
    expect(analyticsResponse.body.totalDemoQueries).toBe(1);
    expect(analyticsResponse.body.totalSettledPayments).toBe(1);
    expect(analyticsResponse.body.recentDemoActivity).toHaveLength(1);
    expect(analyticsResponse.body.recentDemoActivity[0].id).toBe("pay_demo_1");
    expect(analyticsResponse.body.recentSettledPayments).toHaveLength(1);
    expect(analyticsResponse.body.recentSettledPayments[0].id).toBe("pay_settled_1");
    expect(analyticsResponse.body.spendByPaymentSource).toMatchObject({
      demo: 0.01,
      wallet: 0.02
    });
  });

  it("returns capability matrix with correct shape and deterministic order", async () => {
    const app = await createPublicApp();
    const response = await request(app).get("/api/matrix");

    expect(response.status).toBe(200);
    expect(response.body.updatedAt).toEqual(expect.any(String));

    const { providers: matrix } = response.body;
    expect(Array.isArray(matrix)).toBe(true);
    expect(matrix.length).toBeGreaterThan(0);

    for (const entry of matrix) {
      const parsed = providerCapabilitySchema.safeParse(entry);
      expect(parsed.success).toBe(true);
    }

    for (let i = 1; i < matrix.length; i++) {
      const prev = matrix[i - 1];
      const curr = matrix[i];
      const catCmp = prev.category.localeCompare(curr.category);
      if (catCmp === 0) {
        expect(prev.id.localeCompare(curr.id)).toBeLessThanOrEqual(0);
      } else {
        expect(catCmp).toBeLessThan(0);
      }
    }
  });

  describe("analytics export limits and pagination (#135)", () => {
    it("returns stable over_limit_export_size error when /api/usage limit exceeds 500", async () => {
      const app = await createPublicApp();
      const response = await request(app).get("/api/usage?limit=501");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: "over_limit_export_size",
        message: "Export row limit exceeds maximum allowed size of 500",
        max: 500
      });
    });

    it("returns stable over_limit_export_size error when /api/analytics recentUsageLimit exceeds 500", async () => {
      const app = await createPublicApp();
      const response = await request(app).get("/api/analytics?recentUsageLimit=1000");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: "over_limit_export_size",
        message: "Export row limit exceeds maximum allowed size of 500",
        max: 500
      });
    });

    it("returns stable over_limit_export_size error when /api/analytics recentPaymentLimit exceeds 500", async () => {
      const app = await createPublicApp();
      const response = await request(app).get("/api/analytics?recentPaymentLimit=501");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: "over_limit_export_size",
        message: "Export row limit exceeds maximum allowed size of 500",
        max: 500
      });
    });

    it("supports pagination parameters (limit and offset) on /api/usage", async () => {
      const app = await createPublicApp();
      const { persistPaymentAndUsage } = await import("../lib/persistence.js");
      const { buildTestPaymentAttempt, buildTestUsageEvent } = await import("../test/storage-test-helpers.js");

      for (let i = 1; i <= 5; i++) {
        await persistPaymentAndUsage({
          payment: buildTestPaymentAttempt({ id: `pay_page_${i}`, amountUsd: 0.01 }),
          usage: buildTestUsageEvent({ id: `use_page_${i}`, createdAt: `2026-06-21T10:0${i}:00.000Z` })
        });
      }

      const response = await request(app).get("/api/usage?limit=2&offset=1");

      expect(response.status).toBe(200);
      expect(response.body.usage).toHaveLength(2);
      expect(response.body.pagination).toEqual({
        limit: 2,
        offset: 1,
        count: 2
      });
    });
  });
});

