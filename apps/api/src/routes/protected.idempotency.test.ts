import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySponsorshipTestEnv,
  resetSponsorshipStore
} from "../test/sponsorship-test-helpers.js";

const executeQueryMock = vi.fn();

vi.mock("../services/query-service.js", () => ({
  executeQuery: (...args: unknown[]) => executeQueryMock(...args)
}));

function mockQueryResult(traceId = "trace_x402") {
  executeQueryMock.mockResolvedValue({
    mode: "search",
    providerId: "search.basic",
    providerName: "Basic Search",
    priceUsd: 0.01,
    latencyMs: 8,
    timestamp: new Date().toISOString(),
    traceId,
    items: [],
    source: "deterministic-fallback",
    execution: {
      providerId: "search.basic",
      source: "deterministic-fallback",
      usedFallback: true,
      fallbackReason: "deterministic-provider",
      latencyEstimateMs: 700,
      observedDurationMs: 8,
      circuitBreakerState: "closed"
    }
  });
}

async function createTestApp() {
  const { buildDemoPaymentEvidence, setPaymentEvidence } =
    await import("../lib/payment-evidence.js");
  const { protectedRouter } = await import("../routes/protected.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.header("x-query402-demo-paid") === "true") {
      try {
        setPaymentEvidence(req, buildDemoPaymentEvidence(req));
      } catch (error) {
        return next(error);
      }
    }
    return next();
  });
  app.use(protectedRouter);
  return app;
}

function demoPaidRequest(app: express.Express) {
  return request(app)
    .get("/x402/search")
    .query({ provider: "search.basic", q: "test query" })
    .set("x-query402-demo-paid", "true")
    .set("x-demo-payer", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")
    .set("payment-response", "demo-proof-default");
}

describe("x402 idempotency", () => {
  let dbPath: string | undefined;

  beforeEach(() => {
    dbPath = applySponsorshipTestEnv();
    executeQueryMock.mockReset();
    mockQueryResult();
  });

  afterEach(async () => {
    await resetSponsorshipStore(dbPath);
    dbPath = undefined;
  });

  it("returns cached response for idempotent retries", async () => {
    const app = await createTestApp();
    const idempotencyKey = randomUUID();

    const first = await demoPaidRequest(app).set("Idempotency-Key", idempotencyKey);
    expect(first.status).toBe(200);

    const second = await demoPaidRequest(app).set("Idempotency-Key", idempotencyKey);
    expect(second.status).toBe(200);
    expect(second.body.result.traceId).toBe(first.body.result.traceId);
    expect(executeQueryMock).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when idempotency key is reused with different inputs", async () => {
    const app = await createTestApp();
    const idempotencyKey = randomUUID();

    const first = await request(app)
      .get("/x402/search")
      .query({ provider: "search.basic", q: "first query" })
      .set("x-query402-demo-paid", "true")
      .set("x-demo-payer", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")
      .set("Idempotency-Key", idempotencyKey);

    expect(first.status).toBe(200);

    const conflict = await request(app)
      .get("/x402/search")
      .query({ provider: "search.basic", q: "second query" })
      .set("x-query402-demo-paid", "true")
      .set("x-demo-payer", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")
      .set("Idempotency-Key", idempotencyKey);

    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe("idempotency_key_conflict");
    expect(executeQueryMock).toHaveBeenCalledTimes(1);
  });

  it("returns cached response for payment proof replay without re-executing", async () => {
    const app = await createTestApp();

    const first = await demoPaidRequest(app).set("payment-response", "demo-proof-replay");
    expect(first.status).toBe(200);

    const replay = await request(app)
      .get("/x402/search")
      .query({ provider: "search.basic", q: "different query" })
      .set("x-query402-demo-paid", "true")
      .set("x-demo-payer", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")
      .set("payment-response", "demo-proof-replay");

    expect(replay.status).toBe(200);
    expect(replay.body.result.traceId).toBe(first.body.result.traceId);
    expect(executeQueryMock).toHaveBeenCalledTimes(1);
  });

  it("does not replay demo responses without an explicit proof", async () => {
    const app = await createTestApp();

    const first = await request(app)
      .get("/x402/search")
      .query({ provider: "search.basic", q: "first query" })
      .set("x-query402-demo-paid", "true")
      .set("x-demo-payer", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");

    expect(first.status).toBe(200);

    const second = await request(app)
      .get("/x402/search")
      .query({ provider: "search.basic", q: "second query" })
      .set("x-query402-demo-paid", "true")
      .set("x-demo-payer", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");

    expect(second.status).toBe(200);
    expect(executeQueryMock).toHaveBeenCalledTimes(2);
  });
});
