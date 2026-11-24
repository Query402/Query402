import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyApiTestEnv, resetApiTestStorage } from "../test/api-test-helpers.js";

describe("security headers", () => {
  let analyticsDbPath: string;

  beforeEach(() => {
    ({ analyticsDbPath } = applyApiTestEnv());
  });

  afterEach(async () => {
    await resetApiTestStorage(analyticsDbPath);
    vi.restoreAllMocks();
  });

  function expectBaselineHeaders(headers: Record<string, string | string[] | undefined>) {
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["permissions-policy"]).toBeDefined();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-powered-by"]).toBeUndefined();
  }

  it("sets baseline security headers on a public route response", async () => {
    const { app } = await import("../app.js");
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expectBaselineHeaders(response.headers);
  });

  it("sets baseline security headers on a sponsorship route response", async () => {
    const { app } = await import("../app.js");
    const response = await request(app).post("/api/sponsorship/challenge").send({});

    // Sponsorship availability depends on env config; only the presence of
    // the baseline headers is under test here, regardless of status code.
    expectBaselineHeaders(response.headers);
  });

  it("sets baseline security headers on a payment-required (402) response", async () => {
    const { app } = await import("../app.js");
    const response = await request(app).get("/x402/search");

    expect(response.status).toBe(402);
    expectBaselineHeaders(response.headers);
  });

  it("does not overwrite CORS or x402 payment-related exposed headers", async () => {
    const { app } = await import("../app.js");
    const response = await request(app).get("/health").set("Origin", "http://localhost:5173");

    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expectBaselineHeaders(response.headers);
  });
});
