import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyApiTestEnv, resetApiTestStorage } from "../test/api-test-helpers.js";
import { queryCoverageDigest } from "./query-proof.js";

const executeQueryMock = vi.fn();

vi.mock("../services/query-service.js", () => ({
  executeQuery: (...args: unknown[]) => executeQueryMock(...args),
  ProviderTimeoutError: class ProviderTimeoutError extends Error {},
  ProviderFailedError: class ProviderFailedError extends Error {}
}));

function proof(input: { provider: string; target: string; price: string; asset?: string; amount?: string }) {
  return JSON.stringify({
    digest: queryCoverageDigest({
      provider: input.provider,
      target: input.target,
      price: input.price
    }),
    asset: input.asset ?? "USDC",
    amount: input.amount ?? input.price
  });
}

async function createApp() {
  const { createX402Middleware } = await import("./x402.js");
  const { protectedRouter } = await import("../routes/protected.js");
  const app = express();
  app.use(createX402Middleware());
  app.use(protectedRouter);
  return app;
}

describe("paid query proof binding", () => {
  let analyticsDbPath: string;
  let sponsorshipDbPath: string;

  beforeEach(() => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv());
    executeQueryMock.mockReset();
    executeQueryMock.mockResolvedValue({
      mode: "search",
      providerId: "search.basic",
      providerName: "Basic Search",
      priceUsd: 0.01,
      latencyMs: 5,
      timestamp: "2026-09-30T00:00:00.000Z",
      traceId: "trace_fixture",
      items: [{ title: "fixture" }],
      source: "deterministic-fallback",
      execution: {
        providerId: "search.basic",
        source: "deterministic-fallback",
        usedFallback: true,
        fallbackReason: "deterministic-provider",
        latencyEstimateMs: 700,
        observedDurationMs: 5,
        circuitBreakerState: "closed"
      }
    });
  });

  afterEach(async () => {
    await resetApiTestStorage(analyticsDbPath, sponsorshipDbPath);
  });

  it("returns the fixture result for a matching proof", async () => {
    const app = await createApp();
    const response = await request(app)
      .get("/x402/search")
      .query({ provider: "search.basic", q: "stellar x402" })
      .set("x-query402-demo-paid", "true")
      .set(
        "x-query402-proof",
        proof({ provider: "search.basic", target: "stellar x402", price: "0.01" })
      );

    expect(response.status).toBe(200);
    expect(response.body.result.items).toEqual([{ title: "fixture" }]);
    expect(executeQueryMock).toHaveBeenCalledTimes(1);
  });

  it("returns no result for a proof bound to another query", async () => {
    const app = await createApp();
    const response = await request(app)
      .get("/x402/search")
      .query({ provider: "search.basic", q: "stellar x402" })
      .set("x-query402-demo-paid", "true")
      .set(
        "x-query402-proof",
        proof({ provider: "search.pro", target: "other query", price: "0.01" })
      );

    expect(response.status).toBe(402);
    expect(response.body.result).toBeUndefined();
    expect(response.body.error).toBe("payment_proof_mismatch");
    expect(JSON.stringify(response.body)).not.toContain("x-query402-proof");
    expect(executeQueryMock).not.toHaveBeenCalled();
  });

  it("returns no result when the proof amount differs", async () => {
    const app = await createApp();
    const response = await request(app)
      .get("/x402/search")
      .query({ provider: "search.basic", q: "stellar x402" })
      .set("x-query402-demo-paid", "true")
      .set(
        "x-query402-proof",
        proof({ provider: "search.basic", target: "stellar x402", price: "0.01", amount: "0.02" })
      );

    expect(response.status).toBe(402);
    expect(response.body.result).toBeUndefined();
    expect(executeQueryMock).not.toHaveBeenCalled();
  });
});
