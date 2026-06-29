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
      expect(typeof response.body.uptimeSeconds).toBe("number");
      expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("health response includes diagnostics sub-object with safe booleans and enums only", async () => {
    const app = await createPublicApp();
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);

    const { diagnostics } = response.body;
    expect(diagnostics).toBeDefined();

    // All fields are either booleans or safe enum strings — never raw secrets
    expect(typeof diagnostics.network).toBe("string");
    expect(typeof diagnostics.demoMode).toBe("boolean");
    expect(typeof diagnostics.facilitatorConfigured).toBe("boolean");
    expect(typeof diagnostics.facilitatorApiKeyConfigured).toBe("boolean");
    expect(typeof diagnostics.payToConfigured).toBe("boolean");
    expect(typeof diagnostics.sponsorshipEnabled).toBe("boolean");
    expect(typeof diagnostics.sponsorshipSigningSecretConfigured).toBe("boolean");
    expect(typeof diagnostics.anyProviderKeyConfigured).toBe("boolean");
  });

  it("health diagnostics reflects testnet network and demo mode from test env", async () => {
    const app = await createPublicApp();
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body.diagnostics.network).toBe("stellar:testnet");
    expect(response.body.diagnostics.demoMode).toBe(true); // applyApiTestEnv sets DEMO_MODE=true
    expect(response.body.diagnostics.payToConfigured).toBe(true); // TEST_WALLET is set by applySponsorshipTestEnv
  });

  describe("health diagnostics — secret redaction", () => {
    it("never exposes raw secret values in health response body", async () => {
      // Set all secret-like env vars to recognisable sentinel values,
      // then confirm none of them appear anywhere in the response JSON.
      applyApiTestEnv({
        X402_FACILITATOR_API_KEY: "super-secret-facilitator-key",
        SPONSORSHIP_SIGNING_SECRET: "ultra-secret-signing-secret",
        BRAVE_API_KEY: "brave-secret-key",
        SERPAPI_API_KEY: "serpapi-secret-key",
        NEWS_API_KEY: "news-secret-key",
        GROQ_API_KEY: "groq-secret-key"
      });

      const { publicRouter } = await import("../routes/public.js");
      const app = express();
      app.use(publicRouter);

      const response = await request(app).get("/health");
      expect(response.status).toBe(200);

      const body = JSON.stringify(response.body);
      const secretValues = [
        "super-secret-facilitator-key",
        "ultra-secret-signing-secret",
        "brave-secret-key",
        "serpapi-secret-key",
        "news-secret-key",
        "groq-secret-key"
      ];

      for (const secret of secretValues) {
        expect(body).not.toContain(secret);
      }
    });

    it("reports facilitatorApiKeyConfigured=true when key is set, without leaking the value", async () => {
      applyApiTestEnv({ X402_FACILITATOR_API_KEY: "my-confidential-api-key" });

      const { publicRouter } = await import("../routes/public.js");
      const app = express();
      app.use(publicRouter);

      const response = await request(app).get("/health");
      expect(response.status).toBe(200);
      expect(response.body.diagnostics.facilitatorApiKeyConfigured).toBe(true);
      expect(JSON.stringify(response.body)).not.toContain("my-confidential-api-key");
    });

    it("reports facilitatorApiKeyConfigured=false when key is absent", async () => {
      applyApiTestEnv({ X402_FACILITATOR_API_KEY: "" });

      const { publicRouter } = await import("../routes/public.js");
      const app = express();
      app.use(publicRouter);

      const response = await request(app).get("/health");
      expect(response.status).toBe(200);
      expect(response.body.diagnostics.facilitatorApiKeyConfigured).toBe(false);
    });

    it("reports sponsorshipSigningSecretConfigured=true when secret is set, without leaking the value", async () => {
      applyApiTestEnv({ SPONSORSHIP_SIGNING_SECRET: "top-secret-signing-value" });

      const { publicRouter } = await import("../routes/public.js");
      const app = express();
      app.use(publicRouter);

      const response = await request(app).get("/health");
      expect(response.status).toBe(200);
      expect(response.body.diagnostics.sponsorshipSigningSecretConfigured).toBe(true);
      expect(JSON.stringify(response.body)).not.toContain("top-secret-signing-value");
    });

    it("reports anyProviderKeyConfigured=true when at least one provider key is set", async () => {
      applyApiTestEnv({ GROQ_API_KEY: "gsk_test_provider_key" });

      const { publicRouter } = await import("../routes/public.js");
      const app = express();
      app.use(publicRouter);

      const response = await request(app).get("/health");
      expect(response.status).toBe(200);
      expect(response.body.diagnostics.anyProviderKeyConfigured).toBe(true);
      expect(JSON.stringify(response.body)).not.toContain("gsk_test_provider_key");
    });

    it("reports anyProviderKeyConfigured=false when no provider keys are set", async () => {
      applyApiTestEnv({
        BRAVE_API_KEY: "",
        SERPAPI_API_KEY: "",
        NEWS_API_KEY: "",
        GROQ_API_KEY: ""
      });

      const { publicRouter } = await import("../routes/public.js");
      const app = express();
      app.use(publicRouter);

      const response = await request(app).get("/health");
      expect(response.status).toBe(200);
      expect(response.body.diagnostics.anyProviderKeyConfigured).toBe(false);
    });
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
});
