import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRequestIdMiddleware,
  generateRequestId,
  MAX_REQUEST_ID_LENGTH,
  REQUEST_ID_HEADER,
  REQUEST_ID_PATTERN,
  resolveRequestId
} from "./request-id.js";
import { logger } from "./logger.js";

function createApp() {
  const app = express();
  app.use(createRequestIdMiddleware());
  app.get("/probe", (_req, res) => {
    res.json({ requestId: res.locals.requestId, source: res.locals.requestIdSource });
  });
  return app;
}

describe("resolveRequestId", () => {
  it("accepts a well-formed client request id unchanged", () => {
    expect(resolveRequestId("client-trace_01:abc")).toEqual({
      requestId: "client-trace_01:abc",
      source: "client"
    });
  });

  it("generates a safe id when the header is missing or empty", () => {
    for (const value of [undefined, ""]) {
      const resolved = resolveRequestId(value);
      expect(resolved.source).toBe("generated");
      expect(resolved.rejectionReason).toBeUndefined();
      expect(resolved.requestId).toMatch(REQUEST_ID_PATTERN);
    }
  });

  it("rejects ids longer than the documented maximum", () => {
    const tooLong = "a".repeat(MAX_REQUEST_ID_LENGTH + 1);
    const resolved = resolveRequestId(tooLong);

    expect(resolved.source).toBe("generated");
    expect(resolved.rejectionReason).toBe("too_long");
    expect(resolved.requestId).not.toBe(tooLong);
    expect(resolved.requestId.length).toBeLessThanOrEqual(MAX_REQUEST_ID_LENGTH);
  });

  it("accepts an id exactly at the maximum length", () => {
    const atLimit = "b".repeat(MAX_REQUEST_ID_LENGTH);
    expect(resolveRequestId(atLimit)).toEqual({ requestId: atLimit, source: "client" });
  });

  it("rejects control characters and other unsafe characters", () => {
    const unsafeValues = [
      "trace\ninjected",
      "trace\r\ninjected",
      "trace\u0000null",
      "trace\u001funit",
      "trace\u007fdel",
      "trace with space",
      "trace<script>",
      "trace,dup"
    ];

    for (const value of unsafeValues) {
      const resolved = resolveRequestId(value);
      expect(resolved.source).toBe("generated");
      expect(resolved.rejectionReason).toBe("invalid_characters");
      expect(resolved.requestId).not.toContain("\n");
      expect(resolved.requestId).toMatch(REQUEST_ID_PATTERN);
    }
  });

  it("replaces duplicate header values with a generated id", () => {
    const resolved = resolveRequestId(["trace_a", "trace_b"]);
    expect(resolved.source).toBe("generated");
    expect(resolved.rejectionReason).toBe("invalid_characters");
  });
});

describe("generateRequestId", () => {
  it("produces unique, policy-compliant ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateRequestId()));
    expect(ids.size).toBe(50);

    for (const id of ids) {
      expect(id).toMatch(REQUEST_ID_PATTERN);
      expect(id.length).toBeLessThanOrEqual(MAX_REQUEST_ID_LENGTH);
    }
  });
});

describe("request id middleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("echoes a valid client request id in the response header", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    const app = createApp();

    const response = await request(app).get("/probe").set(REQUEST_ID_HEADER, "client-trace-123");

    expect(response.status).toBe(200);
    expect(response.headers[REQUEST_ID_HEADER]).toBe("client-trace-123");
    expect(response.body).toEqual({ requestId: "client-trace-123", source: "client" });
    expect(infoSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ rejectionReason: expect.anything() }),
      expect.anything()
    );
  });

  it("replaces invalid client ids and logs the rejection", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const app = createApp();
    const tooLong = "z".repeat(MAX_REQUEST_ID_LENGTH + 5);

    const response = await request(app).get("/probe").set(REQUEST_ID_HEADER, tooLong);

    expect(response.status).toBe(200);
    const responseId = response.headers[REQUEST_ID_HEADER];
    expect(responseId).toBeDefined();
    expect(responseId).not.toBe(tooLong);
    expect(responseId).toMatch(REQUEST_ID_PATTERN);
    expect(responseId).toHaveLength("req_".length + 21);
    expect(response.body).toEqual({ requestId: responseId, source: "generated" });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: responseId,
        requestIdSource: "generated",
        rejectionReason: "too_long"
      }),
      "discarded invalid inbound request id"
    );
  });

  it("never emits a control-character value into the response header", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const middleware = createRequestIdMiddleware();

    // HTTP clients refuse to transmit CR/LF, so exercise the middleware directly
    // for every control-character class the policy must reject.
    for (const value of [
      "trace\ninjected",
      "trace\tinjected",
      "trace\u007fdel",
      "trace\u0000null"
    ]) {
      const headers: Record<string, string> = {};
      const locals: Record<string, unknown> = {};
      const res = {
        locals,
        setHeader(name: string, headerValue: string) {
          headers[name] = headerValue;
        }
      } as unknown as express.Response;
      const req = {
        headers: { [REQUEST_ID_HEADER]: value },
        method: "GET",
        url: "/probe"
      } as unknown as express.Request;
      const next = vi.fn();

      middleware(req, res, next);

      expect(headers[REQUEST_ID_HEADER]).toMatch(REQUEST_ID_PATTERN);
      expect(headers[REQUEST_ID_HEADER]).not.toBe(value);
      expect(locals.requestId).toBe(headers[REQUEST_ID_HEADER]);
      expect(next).toHaveBeenCalledTimes(1);
    }

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ rejectionReason: "invalid_characters" }),
      "discarded invalid inbound request id"
    );
  });

  it("generates a request id when the client sends none", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const app = createApp();

    const first = await request(app).get("/probe");
    const second = await request(app).get("/probe");

    expect(first.headers[REQUEST_ID_HEADER]).toMatch(REQUEST_ID_PATTERN);
    expect(second.headers[REQUEST_ID_HEADER]).toMatch(REQUEST_ID_PATTERN);
    expect(first.headers[REQUEST_ID_HEADER]).not.toBe(second.headers[REQUEST_ID_HEADER]);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("incoming request logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes the resolved request id in the request log line", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    const app = express();
    app.use(createRequestIdMiddleware());
    app.use((req, res, next) => {
      logger.info(
        {
          requestId: res.locals.requestId,
          requestIdSource: res.locals.requestIdSource,
          method: req.method,
          url: req.url
        },
        "incoming request"
      );
      next();
    });
    app.get("/probe", (_req, res) => {
      res.json({ ok: true });
    });

    await request(app).get("/probe").set(REQUEST_ID_HEADER, "log-trace-1");

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "log-trace-1",
        requestIdSource: "client",
        method: "GET",
        url: "/probe"
      }),
      "incoming request"
    );
  });

  it("logs generated ids for requests without a client id", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    const app = express();
    app.use(createRequestIdMiddleware());
    app.use((_req, res, next) => {
      logger.info(
        { requestId: res.locals.requestId, requestIdSource: res.locals.requestIdSource },
        "incoming request"
      );
      next();
    });
    app.get("/probe", (_req, res) => {
      res.json({ ok: true });
    });

    await request(app).get("/probe");

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: expect.stringMatching(REQUEST_ID_PATTERN),
        requestIdSource: "generated"
      }),
      "incoming request"
    );
  });
});
