import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyApiTestEnv, resetApiTestStorage, TEST_WALLET } from "../test/api-test-helpers.js";

const executeQueryMock = vi.fn();

vi.mock("../services/query-service.js", () => ({
  executeQuery: (...args: unknown[]) => executeQueryMock(...args)
}));

vi.mock("../lib/persistence.js", () => ({
  persistPaymentAndUsage: vi.fn().mockResolvedValue(undefined),
  savePaymentAttempt: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../lib/idempotency/service.js", () => ({
  getResponseByPaymentProof: vi.fn().mockReturnValue(null),
  savePaymentProofResponse: vi.fn()
}));

function mockQueryResult(mode: string, providerId: string, priceUsd: number) {
  executeQueryMock.mockResolvedValueOnce({
    mode,
    providerId,
    providerName: providerId,
    priceUsd,
    latencyMs: 10,
    timestamp: "2026-06-21T10:00:00.000Z",
    traceId: `trace_${providerId}`,
    items: [],
    source: "deterministic-fallback"
  });
}

describe("protected route validation", () => {
  let analyticsDbPath: string;
  let sponsorshipDbPath: string;

  beforeEach(() => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv());
  });

  afterEach(async () => {
    await resetApiTestStorage(analyticsDbPath, sponsorshipDbPath);
    vi.restoreAllMocks();
  });

  async function createValidationApp() {
    const { protectedRouter } = await import("../routes/protected.js");
    const app = express();
    app.use(protectedRouter);
    return app;
  }

  it("rejects invalid search query input", async () => {
    const app = await createValidationApp();

    const missingQuery = await request(app).get("/x402/search").query({ provider: "search.basic" });
    const shortQuery = await request(app)
      .get("/x402/search")
      .query({ provider: "search.basic", q: "x" });

    expect(missingQuery.status).toBe(400);
    expect(shortQuery.status).toBe(400);
  });

  it("rejects invalid news query input", async () => {
    const app = await createValidationApp();

    const response = await request(app).get("/x402/news").query({ provider: "news.fast" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it("rejects invalid scrape query input", async () => {
    const app = await createValidationApp();

    const missingUrl = await request(app).get("/x402/scrape").query({ provider: "scrape.page" });
    const invalidUrl = await request(app)
      .get("/x402/scrape")
      .query({ provider: "scrape.page", url: "not-a-url" });

    expect(missingUrl.status).toBe(400);
    expect(invalidUrl.status).toBe(400);
  });
});

describe("x402 payment debug metadata - helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("computes payment header fingerprint without exposing original", async () => {
    const { computePaymentHeaderFingerprint } = await import("../lib/payment-debug.js");
    const header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const fp = computePaymentHeaderFingerprint(header);
    expect(fp).toBeDefined();
    expect(fp).not.toContain(header);
    expect(fp).toHaveLength(16);
  });

  it("returns undefined for missing payment header", async () => {
    const { computePaymentHeaderFingerprint } = await import("../lib/payment-debug.js");
    expect(computePaymentHeaderFingerprint(undefined)).toBeUndefined();
    expect(computePaymentHeaderFingerprint("")).toBeUndefined();
  });

  it("generates deterministic fingerprints for same input", async () => {
    const { computePaymentHeaderFingerprint } = await import("../lib/payment-debug.js");
    const header = "some-base64-payment-header-value";
    const fp1 = computePaymentHeaderFingerprint(header);
    const fp2 = computePaymentHeaderFingerprint(header);
    expect(fp1).toBe(fp2);
  });

  it("generates different fingerprints for different inputs", async () => {
    const { computePaymentHeaderFingerprint } = await import("../lib/payment-debug.js");
    const fp1 = computePaymentHeaderFingerprint("header-a");
    const fp2 = computePaymentHeaderFingerprint("header-b");
    expect(fp1).not.toBe(fp2);
  });

  it("redacts sensitive values to [REDACTED]", async () => {
    const { redactSensitiveValue } = await import("../lib/payment-debug.js");
    expect(redactSensitiveValue("any-secret-value")).toBe("[REDACTED]");
    expect(redactSensitiveValue("")).toBe("[REDACTED]");
  });

  it("resolves next step for known failure types", async () => {
    const { resolveNextStep } = await import("../lib/payment-debug.js");
    expect(resolveNextStep("payment_required")).toBe("Retry payment");
    expect(resolveNextStep("no_payment_header")).toBe("Retry payment");
    expect(resolveNextStep("settlement_failed")).toBe("Refresh quote");
    expect(resolveNextStep("quote_expired")).toBe("Refresh quote");
    expect(resolveNextStep("facilitator_unavailable")).toBe("Check facilitator availability");
    expect(resolveNextStep("invalid_payment_header")).toBe("Verify payment header");
    expect(resolveNextStep("verification_failed")).toBe("Verify payment header");
  });

  it("falls back to generic next step for unknown failure types", async () => {
    const { resolveNextStep } = await import("../lib/payment-debug.js");
    expect(resolveNextStep("unknown_error")).toBe("Contact support with trace ID");
  });

  it("builds full debug metadata object", async () => {
    const { buildPaymentDebugMetadata } = await import("../lib/payment-debug.js");
    const result = buildPaymentDebugMetadata({
      failureType: "payment_required",
      route: "/x402/search",
      providerId: "search.basic",
      expectedPrice: "$0.01",
      paymentHeader: "test-header",
      traceId: "trace-123"
    });
    expect(result.failureType).toBe("payment_required");
    expect(result.route).toBe("/x402/search");
    expect(result.providerId).toBe("search.basic");
    expect(result.expectedPrice).toBe("$0.01");
    expect(result.paymentHeaderFingerprint).toBeDefined();
    expect(result.paymentHeaderFingerprint).not.toContain("test-header");
    expect(result.traceId).toBe("trace-123");
    expect(result.nextStep).toBe("Retry payment");
  });
});

describe("x402 payment debug metadata - demo mode", () => {
  let analyticsDbPath: string;
  let sponsorshipDbPath: string;

  beforeEach(() => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv());
  });

  afterEach(async () => {
    await resetApiTestStorage(analyticsDbPath, sponsorshipDbPath);
    vi.restoreAllMocks();
  });

  async function createDemoDebugApp() {
    const { createX402Middleware } = await import("../lib/x402.js");
    const { protectedRouter } = await import("../routes/protected.js");
    const app = express();
    app.use(createX402Middleware());
    app.use(protectedRouter);
    return app;
  }

  it("includes debug metadata in 402 payment challenge", async () => {
    const app = await createDemoDebugApp();

    const response = await request(app)
      .get("/x402/search")
      .query({ provider: "search.basic", q: "stellar x402" });

    expect(response.status).toBe(402);
    expect(response.body.debug).toBeDefined();
    expect(response.body.debug.failureType).toBe("payment_required");
    expect(response.body.debug.route).toBe("/x402/search");
    expect(response.body.debug.providerId).toBe("search.basic");
    expect(response.body.debug.expectedPrice).toBeDefined();
    expect(response.body.debug.nextStep).toBe("Retry payment");
  });

  it("does not include debug metadata in successful demo response", async () => {
    const app = await createDemoDebugApp();
    mockQueryResult("search", "search.pro", 0.02);

    const response = await request(app)
      .get("/x402/search")
      .query({ provider: "search.pro", q: "stellar x402" })
      .set("x-query402-demo-paid", "true")
      .set("x-demo-payer", TEST_WALLET)
      .set("payment-response", "demo-proof-123");

    expect(response.status).toBe(200);
    expect(response.body.debug).toBeUndefined();
    expect(response.body.payment).toBeDefined();
    expect(response.body.result).toBeDefined();
    expect(response.body.payment.evidence).toMatchObject({
      kind: "demo",
      status: "demo-paid"
    });
  });

  it("contains expected debug fields in failed response", async () => {
    const app = await createDemoDebugApp();

    const response = await request(app)
      .get("/x402/news")
      .query({ provider: "news.fast", q: "latest news" });

    expect(response.status).toBe(402);
    expect(response.body.debug).toMatchObject({
      failureType: "payment_required",
      route: "/x402/news",
      providerId: "news.fast",
      nextStep: "Retry payment"
    });
    expect(response.body.debug.expectedPrice).toBeDefined();
  });

  it("does not expose full payment headers or sensitive data in failed response", async () => {
    const app = await createDemoDebugApp();

    const response = await request(app)
      .get("/x402/search")
      .query({ provider: "search.basic", q: "test query" })
      .set("Authorization", "Bearer secret-token-12345")
      .set("payment-signature", "eyJhbGciOiJIUzI1NiJ9.eyJwYXllciI6InRlc3QifQ.signature");

    expect(response.status).toBe(402);
    expect(JSON.stringify(response.body)).not.toContain("secret-token-12345");
    expect(JSON.stringify(response.body)).not.toContain(
      "eyJhbGciOiJIUzI1NiJ9.eyJwYXllciI6InRlc3QifQ.signature"
    );
    expect(JSON.stringify(response.body)).not.toContain("Bearer");
  });
});

describe("x402 payment debug metadata - middleware wrapper behavior", () => {
  it("wraps res.json to add debug metadata on 402 responses without modifying existing debug", async () => {
    const { buildPaymentDebugMetadata } = await import("../lib/payment-debug.js");

    const app = express();

    app.use((req, res) => {
      const originalJson = res.json.bind(res);
      res.json = function (body: unknown) {
        if (
          res.statusCode === 402 &&
          body &&
          typeof body === "object" &&
          !("debug" in (body as Record<string, unknown>))
        ) {
          const debug = buildPaymentDebugMetadata({
            failureType: "payment_required",
            route: req.path,
            providerId: "search.basic",
            expectedPrice: "$0.01"
          });
          return originalJson({ ...(body as Record<string, unknown>), debug });
        }
        return originalJson(body);
      };
      res.status(402).json({ error: "Payment Required" });
    });

    const response = await request(app).get("/x402/search?provider=search.basic");

    expect(response.status).toBe(402);
    expect(response.body.debug).toBeDefined();
    expect(response.body.debug.failureType).toBe("payment_required");
    expect(response.body.debug.route).toBe("/x402/search");
    expect(response.body.debug.providerId).toBe("search.basic");
    expect(response.body.debug.expectedPrice).toBe("$0.01");
    expect(response.body.debug.nextStep).toBe("Retry payment");
    expect(response.body.error).toBe("Payment Required");
  });

  it("does not add debug metadata when already present in body", async () => {
    const app = express();

    app.use((_req, res) => {
      res.status(402).json({ error: "test", debug: { existing: true } });
    });

    const response = await request(app).get("/test");
    expect(response.status).toBe(402);
    expect(response.body.debug).toEqual({ existing: true });
  });

  it("does not modify non-402 responses", async () => {
    const app = express();

    app.use((_req, res) => {
      res.status(200).json({ message: "ok" });
    });

    const response = await request(app).get("/test");
    expect(response.status).toBe(200);
    expect(response.body.debug).toBeUndefined();
    expect(response.body.message).toBe("ok");
  });

  it("does not leak sensitive data through wrapper", async () => {
    const { buildPaymentDebugMetadata } = await import("../lib/payment-debug.js");

    const app = express();

    app.use((req, res) => {
      const originalJson = res.json.bind(res);
      res.json = function (body: unknown) {
        if (
          res.statusCode === 402 &&
          body &&
          typeof body === "object" &&
          !("debug" in (body as Record<string, unknown>))
        ) {
          const debug = buildPaymentDebugMetadata({
            failureType: "payment_required",
            route: req.path,
            providerId: "search.basic",
            expectedPrice: "$0.01",
            paymentHeader: req.header("x-payment")
          });
          return originalJson({ ...(body as Record<string, unknown>), debug });
        }
        return originalJson(body);
      };
      res.status(402).json({ error: "Payment Required" });
    });

    const response = await request(app)
      .get("/test")
      .set("x-payment", "sensitive-crypto-material")
      .set("Authorization", "Bearer secret-key");

    expect(response.status).toBe(402);
    const bodyStr = JSON.stringify(response.body);
    expect(bodyStr).not.toContain("sensitive-crypto-material");
    expect(bodyStr).not.toContain("secret-key");
    expect(bodyStr).not.toContain("Bearer");
    expect(response.body.debug.paymentHeaderFingerprint).toBeDefined();
    expect(response.body.debug.paymentHeaderFingerprint).not.toContain("sensitive-crypto-material");
  });
});
