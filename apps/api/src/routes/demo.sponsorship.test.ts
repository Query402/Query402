import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OTHER_WALLET,
  TEST_WALLET,
  applySponsorshipTestEnv,
  createSignedGrant,
  encodeGrantHeader,
  readGlobalBudgetSpent,
  resetSponsorshipStore
} from "../test/sponsorship-test-helpers.js";

const runPaidRequestMock = vi.fn();
const persistSponsoredPaymentMock = vi.fn();

vi.mock("../lib/demo-client.js", () => ({
  runPaidRequest: (...args: unknown[]) => runPaidRequestMock(...args)
}));

vi.mock("../lib/persistence.js", () => ({
  persistSponsoredPayment: (...args: unknown[]) => persistSponsoredPaymentMock(...args)
}));

function mockSuccessfulPayment() {
  runPaidRequestMock.mockResolvedValue({
    ok: true,
    status: 200,
    endpoint: "http://localhost:3001/x402/search?provider=search.basic&q=test+query",
    paymentResponseHeader: "tx_test",
    payload: {
      payment: {
        network: "stellar:testnet",
        facilitatorUrl: "https://example.com",
        paymentResponseHeader: "tx_test"
      },
      result: {
        mode: "search",
        providerId: "search.basic",
        providerName: "Basic Search",
        priceUsd: 0.01,
        latencyMs: 12,
        timestamp: new Date().toISOString(),
        traceId: "trace_test",
        items: []
      }
    }
  });
}

async function createTestApp() {
  const { paidRouter } = await import("../routes/demo.js");
  const app = express();
  app.use(express.json());
  app.use(paidRouter);
  return app;
}

async function postPaidRun(
  app: express.Express,
  signedGrant: Awaited<ReturnType<typeof createSignedGrant>>,
  options: { idempotencyKey?: string; wallet?: string } = {}
) {
  const httpRequest = request(app)
    .post("/api/paid/run")
    .set("X-Sponsorship-Grant", encodeGrantHeader(signedGrant));

  if (options.idempotencyKey) {
    httpRequest.set("Idempotency-Key", options.idempotencyKey);
  }

  return httpRequest.send({
    mode: "search",
    provider: "search.basic",
    wallet: options.wallet ?? TEST_WALLET,
    query: "test query"
  });
}

describe("POST /api/paid/run sponsorship", () => {
  let dbPath: string;

  beforeEach(() => {
    runPaidRequestMock.mockReset();
    persistSponsoredPaymentMock.mockReset();
    mockSuccessfulPayment();
  });

  afterEach(async () => {
    await resetSponsorshipStore(dbPath);
    vi.restoreAllMocks();
  });

  it("returns 200 and reserves budget for a valid grant", async () => {
    dbPath = applySponsorshipTestEnv();
    const app = await createTestApp();
    const signedGrant = await createSignedGrant();

    const response = await postPaidRun(app, signedGrant);

    expect(response.status).toBe(200);
    expect(runPaidRequestMock).toHaveBeenCalledTimes(1);
    expect(persistSponsoredPaymentMock).toHaveBeenCalledTimes(1);
    expect(await readGlobalBudgetSpent()).toBeCloseTo(0.01, 6);
  });

  it("returns 403 for expired grants", async () => {
    dbPath = applySponsorshipTestEnv();
    const app = await createTestApp();
    const signedGrant = await createSignedGrant({
      expiresAt: new Date(Date.now() - 60_000).toISOString()
    });

    const response = await postPaidRun(app, signedGrant);

    expect(response.status).toBe(403);
    expect(response.body.decision).toBe("denied_expired");
    expect(runPaidRequestMock).not.toHaveBeenCalled();
  });

  it("returns 403 for wrong wallet", async () => {
    dbPath = applySponsorshipTestEnv();
    const app = await createTestApp();
    const signedGrant = await createSignedGrant();

    const response = await postPaidRun(app, signedGrant, { wallet: OTHER_WALLET });

    expect(response.status).toBe(403);
    expect(response.body.decision).toBe("denied_wrong_wallet");
    expect(runPaidRequestMock).not.toHaveBeenCalled();
  });

  it("returns 403 for wrong network", async () => {
    dbPath = applySponsorshipTestEnv();
    const app = await createTestApp();
    const signedGrant = await createSignedGrant({ network: "stellar:pubnet" });

    const response = await postPaidRun(app, signedGrant);

    expect(response.status).toBe(403);
    expect(response.body.decision).toBe("denied_wrong_network");
    expect(runPaidRequestMock).not.toHaveBeenCalled();
  });

  it("returns 403 for wrong provider", async () => {
    dbPath = applySponsorshipTestEnv();
    const app = await createTestApp();
    const signedGrant = await createSignedGrant({ mode: "news" });

    const response = await postPaidRun(app, signedGrant);

    expect(response.status).toBe(403);
    expect(response.body.decision).toBe("denied_wrong_provider");
    expect(runPaidRequestMock).not.toHaveBeenCalled();
  });

  it("returns 403 when price exceeds grant maxAmountUsd", async () => {
    dbPath = applySponsorshipTestEnv();
    const app = await createTestApp();
    const signedGrant = await createSignedGrant({ maxAmountUsd: 0.005 });

    const response = await postPaidRun(app, signedGrant);

    expect(response.status).toBe(403);
    expect(response.body.decision).toBe("denied_price_exceeded");
    expect(runPaidRequestMock).not.toHaveBeenCalled();
  });

  it("returns 409 for reused nonce", async () => {
    dbPath = applySponsorshipTestEnv();
    const app = await createTestApp();
    const signedGrant = await createSignedGrant();

    const first = await postPaidRun(app, signedGrant);
    expect(first.status).toBe(200);

    const second = await postPaidRun(app, signedGrant);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("nonce_replay");
    expect(runPaidRequestMock).toHaveBeenCalledTimes(1);
  });

  it("returns 429 when per-wallet budget is exceeded", async () => {
    dbPath = applySponsorshipTestEnv({
      SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD: "0.01"
    });
    const app = await createTestApp();

    const firstGrant = await createSignedGrant();
    const first = await postPaidRun(app, firstGrant);
    expect(first.status).toBe(200);

    const secondGrant = await createSignedGrant();
    const second = await postPaidRun(app, secondGrant);

    expect(second.status).toBe(429);
    expect(second.body.error).toBe("wallet_budget_exceeded");
    expect(runPaidRequestMock).toHaveBeenCalledTimes(1);
  });

  it("returns 429 when global budget is exceeded", async () => {
    dbPath = applySponsorshipTestEnv({
      SPONSORSHIP_GLOBAL_DAILY_BUDGET_USD: "0.01",
      SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD: "1"
    });
    const app = await createTestApp();

    const firstGrant = await createSignedGrant({ wallet: TEST_WALLET });
    expect((await postPaidRun(app, firstGrant)).status).toBe(200);

    const secondGrant = await createSignedGrant({ wallet: OTHER_WALLET });
    const second = await postPaidRun(app, secondGrant, { wallet: OTHER_WALLET });

    expect(second.status).toBe(429);
    expect(second.body.error).toBe("global_budget_exceeded");
    expect(runPaidRequestMock).toHaveBeenCalledTimes(1);
  });

  it("spends only once for 50 concurrent requests with the same idempotency key", async () => {
    dbPath = applySponsorshipTestEnv();
    const app = await createTestApp();
    const signedGrant = await createSignedGrant();
    const idempotencyKey = randomUUID();

    const responses = await Promise.all(
      Array.from({ length: 50 }, () => postPaidRun(app, signedGrant, { idempotencyKey }))
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(runPaidRequestMock).toHaveBeenCalledTimes(1);
    expect(await readGlobalBudgetSpent()).toBeCloseTo(0.01, 6);
  });

  it("includes Cache-Control: no-store on 200 response", async () => {
    dbPath = applySponsorshipTestEnv();
    const app = await createTestApp();
    const signedGrant = await createSignedGrant();

    const response = await postPaidRun(app, signedGrant);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("returns 503 and skips payment when sponsorship is disabled", async () => {
    dbPath = applySponsorshipTestEnv({ SPONSORSHIP_ENABLED: "false" });
    const app = await createTestApp();
    const signedGrant = await createSignedGrant();

    const response = await postPaidRun(app, signedGrant);

    expect(response.status).toBe(503);
    expect(response.body.decision).toBe("denied_sponsorship_disabled");
    expect(runPaidRequestMock).not.toHaveBeenCalled();
  });

  it("returns 503 when sqlite storage is unavailable", async () => {
    dbPath = applySponsorshipTestEnv();
    const store = await import("../lib/sponsorship/store.js");
    vi.spyOn(store, "isSponsorshipStorageAvailable").mockReturnValue(false);

    const app = await createTestApp();
    const signedGrant = await createSignedGrant();
    const response = await postPaidRun(app, signedGrant);

    expect(response.status).toBe(503);
    expect(response.body.decision).toBe("denied_storage_unavailable");
    expect(runPaidRequestMock).not.toHaveBeenCalled();
  });

  it("returns cached response for idempotency retries with a fresh grant", async () => {
    dbPath = applySponsorshipTestEnv();
    const app = await createTestApp();
    const idempotencyKey = randomUUID();

    const firstGrant = await createSignedGrant();
    const first = await postPaidRun(app, firstGrant, { idempotencyKey });
    expect(first.status).toBe(200);

    const secondGrant = await createSignedGrant();
    const second = await postPaidRun(app, secondGrant, { idempotencyKey });

    expect(second.status).toBe(200);
    expect(second.body.result.traceId).toBe(first.body.result.traceId);
    expect(runPaidRequestMock).toHaveBeenCalledTimes(1);
    expect(await readGlobalBudgetSpent()).toBeCloseTo(0.01, 6);
  });

  it("returns 409 when idempotency key is reused with a different query", async () => {
    dbPath = applySponsorshipTestEnv();
    const app = await createTestApp();
    const idempotencyKey = randomUUID();
    const signedGrant = await createSignedGrant();

    const first = await postPaidRun(app, signedGrant, { idempotencyKey });
    expect(first.status).toBe(200);

    const conflict = await request(app)
      .post("/api/paid/run")
      .set("Idempotency-Key", idempotencyKey)
      .set("X-Sponsorship-Grant", encodeGrantHeader(await createSignedGrant()))
      .send({
        mode: "search",
        provider: "search.basic",
        wallet: TEST_WALLET,
        query: "different query"
      });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe("idempotency_key_conflict");
    expect(runPaidRequestMock).toHaveBeenCalledTimes(1);
  });
});
