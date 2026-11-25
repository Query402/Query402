import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyApiTestEnv, resetApiTestStorage } from "../test/api-test-helpers.js";

describe("sponsorship cache-control", () => {
  let analyticsDbPath: string;
  let sponsorshipDbPath: string;

  beforeEach(() => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv());
  });

  afterEach(async () => {
    await resetApiTestStorage(analyticsDbPath, sponsorshipDbPath);
    vi.restoreAllMocks();
  });

  async function createApp() {
    const { sponsorshipRouter } = await import("../routes/sponsorship.js");
    const app = express();
    app.use(express.json());
    app.use(sponsorshipRouter);
    return app;
  }

  it("sets Cache-Control: no-store on challenge validation failure", async () => {
    const app = await createApp();
    const response = await request(app).post("/api/sponsorship/challenge").send({});
    expect(response.status).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store on challenge success", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/sponsorship/challenge")
      .send({ wallet: "G" + "A".repeat(55) });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store when sponsorship is disabled", async () => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv({ SPONSORSHIP_ENABLED: "false" }));
    const app = await createApp();
    const response = await request(app)
      .post("/api/sponsorship/challenge")
      .send({ wallet: "G" + "A".repeat(55) });
    expect(response.status).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store on grants validation failure", async () => {
    const app = await createApp();
    const response = await request(app).post("/api/sponsorship/grants").send({});
    expect(response.status).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store on grants when signing not configured", async () => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv({ SPONSORSHIP_SIGNING_SECRET: "" }));
    const app = await createApp();
    const response = await request(app)
      .post("/api/sponsorship/grants")
      .send({ wallet: "G" + "A".repeat(55), challengeId: "00000000-0000-4000-8000-000000000000", signature: "sig" });
    expect(response.status).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store on preview validation failure", async () => {
    const app = await createApp();
    const response = await request(app).post("/api/sponsorship/preview").send({});
    expect(response.status).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store on preview success", async () => {
    const app = await createApp();
    const response = await request(app).post("/api/sponsorship/preview").send({
      wallet: "G" + "A".repeat(55),
      mode: "search",
      provider: "search.basic"
    });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store on rate-limited challenge", async () => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv({ CHALLENGE_RATE_LIMIT_PER_MINUTE: "1" }));
    const app = await createApp();
    const wallet = "G" + "A".repeat(55);
    await request(app).post("/api/sponsorship/challenge").send({ wallet });
    const limited = await request(app).post("/api/sponsorship/challenge").send({ wallet });
    expect(limited.status).toBe(429);
    expect(limited.headers["cache-control"]).toBe("no-store");
  });
});