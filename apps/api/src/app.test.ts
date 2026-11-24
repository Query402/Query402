import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyApiTestEnv, resetApiTestStorage } from "./test/api-test-helpers.js";

const FAKE_SECRET = "sk_test_fake_secret_value";
const FAKE_PATH = "/var/lib/query402/payments.sqlite";

describe("global API error handler", () => {
  let analyticsDbPath: string;
  let sponsorshipDbPath: string;

  beforeEach(() => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv());
  });

  afterEach(async () => {
    await resetApiTestStorage(analyticsDbPath, sponsorshipDbPath);
    vi.restoreAllMocks();
  });

  async function createApp(setup: (app: express.Express) => void) {
    const [{ handleApiError }, { logger }] = await Promise.all([
      import("./app.js"),
      import("./lib/logger.js")
    ]);
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const app = express();
    setup(app);
    app.use(handleApiError);
    return { app, errorSpy };
  }

  it("hides unknown errors that contain a secret and a filesystem path", async () => {
    const { app, errorSpy } = await createApp((testApp) => {
      testApp.get("/boom", () => {
        const failure = new Error(`database open failed at ${FAKE_PATH} secret=${FAKE_SECRET}`);
        failure.stack = `${failure.stack}\n    at Database.open (${FAKE_PATH}:12:3)`;
        throw failure;
      });
    });

    for (const nodeEnv of ["development", "test", "production"]) {
      process.env.NODE_ENV = nodeEnv;
      const response = await request(app).get("/boom");
      const serialized = `${JSON.stringify(response.body)}\n${response.text}`;

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: "Internal server error",
        type: "internal_error",
        errorCode: "internal_error"
      });
      expect(response.body.stack).toBeUndefined();
      expect(serialized).not.toContain(FAKE_SECRET);
      expect(serialized).not.toContain(FAKE_PATH);
      expect(serialized).not.toContain("Database.open");
    }

    expect(errorSpy).toHaveBeenCalled();
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain(FAKE_SECRET);
    expect(logged).toContain(FAKE_PATH);
    expect(logged).toContain("unhandled request error");
  });

  it("keeps typed provider timeout and failure responses", async () => {
    const { ProviderTimeoutError, ProviderFailedError } =
      await import("./services/query-service.js");
    const { app } = await createApp((testApp) => {
      testApp.get("/timeout", () => {
        throw new ProviderTimeoutError("Request timed out");
      });
      testApp.get("/failed", () => {
        throw new ProviderFailedError("Provider down");
      });
    });

    const timeout = await request(app).get("/timeout");
    const failed = await request(app).get("/failed");

    expect(timeout.status).toBe(504);
    expect(timeout.body).toEqual({
      error: "Request timed out",
      type: "provider_timeout",
      errorCode: "provider_timeout"
    });
    expect(failed.status).toBe(502);
    expect(failed.body).toEqual({
      error: "Provider down",
      type: "provider_failed",
      errorCode: "provider_failed"
    });
  });
});

describe("API access logging", () => {
  it("logs the route path without query-string values", async () => {
    applyApiTestEnv();
    const [{ logApiRequest }, { logger }] = await Promise.all([
      import("./app.js"),
      import("./lib/logger.js")
    ]);
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const testApp = express();
    testApp.use(logApiRequest);
    testApp.get("/x402/search", (_req, res) => res.sendStatus(204));

    await request(testApp)
      .get("/x402/search")
      .query({ q: "secret-query-value", provider: "secret-provider-value" })
      .expect(204);

    expect(infoSpy).toHaveBeenCalledWith(
      { method: "GET", path: "/x402/search" },
      "incoming request"
    );
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain("secret-query-value");
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain("secret-provider-value");
  });
});
