import { randomUUID } from "node:crypto";
import { MAX_IDEMPOTENCY_KEY_BYTES } from "@query402/shared";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyApiTestEnv, resetApiTestStorage } from "../test/api-test-helpers.js";

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
  let analyticsDbPath: string | undefined;
  let sponsorshipDbPath: string | undefined;

  beforeEach(() => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv());
    executeQueryMock.mockReset();
    mockQueryResult();
  });

  afterEach(async () => {
    await resetApiTestStorage(analyticsDbPath, sponsorshipDbPath);
    analyticsDbPath = undefined;
    sponsorshipDbPath = undefined;
  });

  it("returns cached response for idempotent retries", async () => {
    const app = await createTestApp();
    const idempotencyKey = randomUUID();

    const first = await demoPaidRequest(app).set("Idempotency-Key", idempotencyKey);
    expect(first.status).toBe(200);
    expect(first.body.traceId).toBe(first.body.result.traceId);

    const second = await demoPaidRequest(app).set("Idempotency-Key", idempotencyKey);
    expect(second.status).toBe(200);
    expect(second.body.traceId).toBe(first.body.traceId);
    expect(second.body.result.traceId).toBe(first.body.result.traceId);
    expect(executeQueryMock).toHaveBeenCalledTimes(1);
  });

  it("accepts an idempotency key at the documented maximum byte length", async () => {
    const app = await createTestApp();
    const idempotencyKey = "k".repeat(MAX_IDEMPOTENCY_KEY_BYTES);

    const first = await demoPaidRequest(app).set("Idempotency-Key", idempotencyKey);
    expect(first.status).toBe(200);

    const retry = await demoPaidRequest(app).set("Idempotency-Key", idempotencyKey);
    expect(retry.status).toBe(200);
    expect(retry.body.traceId).toBe(first.body.traceId);
    expect(executeQueryMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an idempotency key one byte over the maximum before provider work", async () => {
    const app = await createTestApp();
    const idempotencyKey = "k".repeat(MAX_IDEMPOTENCY_KEY_BYTES + 1);

    const response = await demoPaidRequest(app).set("Idempotency-Key", idempotencyKey);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid Idempotency-Key header",
      type: "invalid_idempotency_key",
      errorCode: "invalid_idempotency_key"
    });
    expect(executeQueryMock).not.toHaveBeenCalled();
  });

  it("rejects empty and repeated idempotency keys before provider work", async () => {
    const app = await createTestApp();

    const empty = await demoPaidRequest(app).set("Idempotency-Key", "   ");
    expect(empty.status).toBe(400);
    expect(empty.body.errorCode).toBe("invalid_idempotency_key");

    // superagent sends an array as two raw header lines; the cast is needed
    // because its types only allow a single string value.
    const repeated = await demoPaidRequest(app).set("Idempotency-Key", [
      "first-key",
      "second-key"
    ] as unknown as string);
    expect(repeated.status).toBe(400);
    expect(repeated.body.errorCode).toBe("invalid_idempotency_key");
    expect(executeQueryMock).not.toHaveBeenCalled();
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

  it("returns cached response for payment proof replay with the same body", async () => {
    const app = await createTestApp();

    const first = await demoPaidRequest(app).set("payment-response", "demo-proof-replay");
    expect(first.status).toBe(200);

    const replay = await demoPaidRequest(app).set("payment-response", "demo-proof-replay");

    expect(replay.status).toBe(200);
    expect(replay.body.traceId).toBe(first.body.traceId);
    expect(replay.body.result.traceId).toBe(first.body.result.traceId);
    expect(executeQueryMock).toHaveBeenCalledTimes(1);
  });

  it("rejects payment proof replay when the query body differs", async () => {
    const app = await createTestApp();

    const first = await demoPaidRequest(app).set("payment-response", "demo-proof-replay");
    expect(first.status).toBe(200);

    const conflict = await request(app)
      .get("/x402/search")
      .query({ provider: "search.basic", q: "different query" })
      .set("x-query402-demo-paid", "true")
      .set("x-demo-payer", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")
      .set("payment-response", "demo-proof-replay");

    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe("payment_proof_conflict");
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
