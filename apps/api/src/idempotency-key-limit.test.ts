import { MAX_IDEMPOTENCY_KEY_BYTES } from "@query402/shared";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyApiTestEnv, resetApiTestStorage } from "./test/api-test-helpers.js";

describe("Idempotency-Key header limit", () => {
  let analyticsDbPath: string | undefined;
  let sponsorshipDbPath: string | undefined;

  beforeEach(() => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv());
  });

  afterEach(async () => {
    await resetApiTestStorage(analyticsDbPath, sponsorshipDbPath);
    analyticsDbPath = undefined;
    sponsorshipDbPath = undefined;
    vi.restoreAllMocks();
  });

  it("rejects an oversized key before the x402 payment challenge is issued", async () => {
    const { app } = await import("./app.js");

    const response = await request(app)
      .get("/x402/search")
      .query({ provider: "search.basic", q: "test query" })
      .set("Idempotency-Key", "k".repeat(MAX_IDEMPOTENCY_KEY_BYTES + 1));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid Idempotency-Key header",
      type: "invalid_idempotency_key",
      errorCode: "invalid_idempotency_key"
    });
    expect(response.body).not.toHaveProperty("accepts");
  });

  it("still issues the payment challenge when the key is exactly at the limit", async () => {
    const { app } = await import("./app.js");

    const response = await request(app)
      .get("/x402/search")
      .query({ provider: "search.basic", q: "test query" })
      .set("Idempotency-Key", "k".repeat(MAX_IDEMPOTENCY_KEY_BYTES));

    expect(response.status).toBe(402);
    expect(response.body.errorCode).toBe("payment_required");
  });

  it("rejects an oversized key on the grant route before body validation", async () => {
    const { sponsorshipRouter } = await import("./routes/sponsorship.js");
    const app = express();
    app.use(express.json());
    app.use(sponsorshipRouter);

    const response = await request(app)
      .post("/api/sponsorship/grants")
      .set("Idempotency-Key", "k".repeat(MAX_IDEMPOTENCY_KEY_BYTES + 1))
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe("invalid_idempotency_key");
  });

  it("leaves routes that do not consume the header unaffected", async () => {
    const { app } = await import("./app.js");

    const response = await request(app)
      .get("/health")
      .set("Idempotency-Key", "k".repeat(MAX_IDEMPOTENCY_KEY_BYTES + 1));

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
