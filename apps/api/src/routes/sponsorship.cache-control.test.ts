import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyApiTestEnv, resetApiTestStorage, TEST_WALLET } from "../test/api-test-helpers.js";

const DEFAULT_JSON_BODY_MAX_BYTES = 64 * 1024;

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

  // The header is applied by the app, ahead of the JSON parser, so these tests go
  // through the real app instead of a hand-assembled router.
  async function loadApp() {
    const { app } = await import("../app.js");
    return app;
  }

  it("sets Cache-Control: no-store on challenge validation failure", async () => {
    const app = await loadApp();
    const response = await request(app).post("/api/sponsorship/challenge").send({});
    expect(response.status).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store on challenge success", async () => {
    const app = await loadApp();
    const response = await request(app)
      .post("/api/sponsorship/challenge")
      .send({ wallet: TEST_WALLET });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store when sponsorship is disabled", async () => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv({ SPONSORSHIP_ENABLED: "false" }));
    const app = await loadApp();
    const response = await request(app)
      .post("/api/sponsorship/challenge")
      .send({ wallet: TEST_WALLET });
    expect(response.status).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store on grants validation failure", async () => {
    const app = await loadApp();
    const response = await request(app).post("/api/sponsorship/grants").send({});
    expect(response.status).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store on grants when signing not configured", async () => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv({ SPONSORSHIP_SIGNING_SECRET: "" }));
    const app = await loadApp();
    const response = await request(app).post("/api/sponsorship/grants").send({
      wallet: TEST_WALLET,
      challengeId: "00000000-0000-4000-8000-000000000000",
      signature: "sig"
    });
    expect(response.status).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store on preview validation failure", async () => {
    const app = await loadApp();
    const response = await request(app).post("/api/sponsorship/preview").send({});
    expect(response.status).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store on preview success", async () => {
    const app = await loadApp();
    const response = await request(app).post("/api/sponsorship/preview").send({
      wallet: TEST_WALLET,
      mode: "search",
      provider: "search.basic"
    });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store on rate-limited challenge", async () => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv({
      CHALLENGE_RATE_LIMIT_PER_MINUTE: "1"
    }));
    const app = await loadApp();
    await request(app).post("/api/sponsorship/challenge").send({ wallet: TEST_WALLET });
    const limited = await request(app)
      .post("/api/sponsorship/challenge")
      .send({ wallet: TEST_WALLET });
    expect(limited.status).toBe(429);
    expect(limited.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store on a JSON parse failure", async () => {
    const app = await loadApp();
    const response = await request(app)
      .post("/api/sponsorship/challenge")
      .set("Content-Type", "application/json")
      .send('{"wallet":');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sets Cache-Control: no-store on an oversized JSON body", async () => {
    const app = await loadApp();
    const response = await request(app)
      .post("/api/sponsorship/challenge")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ wallet: "G" + "A".repeat(DEFAULT_JSON_BODY_MAX_BYTES) }));
    expect(response.status).toBe(413);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("leaves Cache-Control untouched on paths outside the sponsorship prefix", async () => {
    const app = await loadApp();
    const response = await request(app).get("/api/unknown");
    expect(response.status).toBe(404);
    expect(response.body?.errorCode).toBe("route_not_found");
    expect(response.headers["cache-control"]).toBeUndefined();
  });
});
