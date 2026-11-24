import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyApiTestEnv, resetApiTestStorage } from "./test/api-test-helpers.js";

const DEFAULT_JSON_BODY_MAX_BYTES = 64 * 1024;
const REJECTED_BODY_MARKER = "Q402_REJECTED_BODY";

function jsonObjectOfByteLength(byteLength: number, marker = ""): string {
  const prefix = '{"pad":"';
  const suffix = '"}';
  const padLength = byteLength - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
  if (padLength < Buffer.byteLength(marker)) {
    throw new Error(`Cannot build a JSON object of ${byteLength} bytes`);
  }

  const body = `${prefix}${marker}${"a".repeat(padLength - marker.length)}${suffix}`;
  if (Buffer.byteLength(body) !== byteLength) {
    throw new Error(`Expected ${byteLength} bytes, built ${Buffer.byteLength(body)}`);
  }

  return body;
}

describe("JSON request body limit", () => {
  let analyticsDbPath: string;
  let sponsorshipDbPath: string;
  const previousLimit = process.env.API_JSON_BODY_MAX_BYTES;

  beforeEach(() => {
    delete process.env.API_JSON_BODY_MAX_BYTES;
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv());
  });

  afterEach(async () => {
    if (previousLimit === undefined) {
      delete process.env.API_JSON_BODY_MAX_BYTES;
    } else {
      process.env.API_JSON_BODY_MAX_BYTES = previousLimit;
    }

    await resetApiTestStorage(analyticsDbPath, sponsorshipDbPath);
    vi.restoreAllMocks();
  });

  async function loadApp() {
    const [{ app }, { config }, { logger }] = await Promise.all([
      import("./app.js"),
      import("./lib/config.js"),
      import("./lib/logger.js")
    ]);

    return { app, config, logger };
  }

  async function postJson(byteLength: number, marker = "") {
    const { app, logger } = await loadApp();
    const payload = jsonObjectOfByteLength(byteLength, marker);
    const info = vi.spyOn(logger, "info");
    const warn = vi.spyOn(logger, "warn");
    const error = vi.spyOn(logger, "error");

    const response = await request(app)
      .post("/health")
      .set("Content-Type", "application/json")
      .send(payload);

    return { response, logs: [info, warn, error] };
  }

  it("does not report malformed JSON inside the limit as too large", async () => {
    const { app } = await loadApp();
    const response = await request(app)
      .post("/health")
      .set("Content-Type", "application/json")
      .send("{");

    expect(response.status).not.toBe(413);
    expect(response.body?.errorCode).not.toBe("json_body_too_large");
  });

  it("defaults API_JSON_BODY_MAX_BYTES to 64 KiB", async () => {
    const { config } = await loadApp();

    expect(config.API_JSON_BODY_MAX_BYTES).toBe(DEFAULT_JSON_BODY_MAX_BYTES);
    expect(DEFAULT_JSON_BODY_MAX_BYTES).toBe(65536);
  });

  it("accepts a JSON body of exactly the configured maximum", async () => {
    const { response, logs } = await postJson(DEFAULT_JSON_BODY_MAX_BYTES, REJECTED_BODY_MARKER);

    expect(response.status).toBe(404);
    expect(response.body?.errorCode).not.toBe("json_body_too_large");
    expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain(
      REJECTED_BODY_MARKER
    );
  });

  it("returns 413 with a stable error code when the body is one byte over the limit", async () => {
    const { response, logs } = await postJson(
      DEFAULT_JSON_BODY_MAX_BYTES + 1,
      REJECTED_BODY_MARKER
    );

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: "JSON request body exceeds the configured size limit",
      type: "json_body_too_large",
      errorCode: "json_body_too_large"
    });
    expect(JSON.stringify(response.body)).not.toContain(REJECTED_BODY_MARKER);
    expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain(
      REJECTED_BODY_MARKER
    );
  });

  it("uses API_JSON_BODY_MAX_BYTES when it is set", async () => {
    process.env.API_JSON_BODY_MAX_BYTES = "128";
    const { config } = await loadApp();
    expect(config.API_JSON_BODY_MAX_BYTES).toBe(128);

    const accepted = await postJson(128, REJECTED_BODY_MARKER);
    expect(accepted.response.status).toBe(404);
    expect(accepted.response.body?.errorCode).not.toBe("json_body_too_large");
    expect(JSON.stringify(accepted.logs.flatMap((spy) => spy.mock.calls))).not.toContain(
      REJECTED_BODY_MARKER
    );

    const rejected = await postJson(129, REJECTED_BODY_MARKER);
    expect(rejected.response.status).toBe(413);
    expect(rejected.response.body.errorCode).toBe("json_body_too_large");
    expect(JSON.stringify(rejected.response.body)).not.toContain(REJECTED_BODY_MARKER);
    expect(JSON.stringify(rejected.logs.flatMap((spy) => spy.mock.calls))).not.toContain(
      REJECTED_BODY_MARKER
    );
  });
});
