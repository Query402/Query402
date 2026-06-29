import { describe, expect, it } from "vitest";
import { isSensitiveHeader, redactSensitiveHeaders } from "./redact-headers.js";

describe("redactSensitiveHeaders", () => {
  it("redacts payment header case-insensitively", () => {
    const headers = {
      payment: "base64payload",
      "X-Custom": "value"
    };

    const result = redactSensitiveHeaders(headers);

    expect(result.payment).toBe("[REDACTED]");
    expect(result["X-Custom"]).toBe("value");
  });

  it("redacts payment-response header case-insensitively", () => {
    const headers = {
      "Payment-Response": "response-data",
      "Content-Type": "application/json"
    };

    const result = redactSensitiveHeaders(headers);

    expect(result["Payment-Response"]).toBe("[REDACTED]");
    expect(result["Content-Type"]).toBe("application/json");
  });

  it("redacts authorization header case-insensitively", () => {
    const headers = {
      AUTHORIZATION: "Bearer token123",
      "X-Request-Id": "abc123"
    };

    const result = redactSensitiveHeaders(headers);

    expect(result.AUTHORIZATION).toBe("[REDACTED]");
    expect(result["X-Request-Id"]).toBe("abc123");
  });

  it("preserves non-sensitive headers used for debugging", () => {
    const headers = {
      "X-Trace-Id": "trace-123",
      "X-Request-Id": "req-456",
      "User-Agent": "test-agent",
      "Content-Type": "application/json"
    };

    const result = redactSensitiveHeaders(headers);

    expect(result["X-Trace-Id"]).toBe("trace-123");
    expect(result["X-Request-Id"]).toBe("req-456");
    expect(result["User-Agent"]).toBe("test-agent");
    expect(result["Content-Type"]).toBe("application/json");
  });

  it("handles empty headers object", () => {
    const result = redactSensitiveHeaders({});
    expect(result).toEqual({});
  });

  it("handles undefined values in headers", () => {
    const headers = {
      payment: undefined,
      "X-Custom": "value"
    };

    const result = redactSensitiveHeaders(headers);

    expect(result.payment).toBe("[REDACTED]");
    expect(result["X-Custom"]).toBe("value");
  });
});

describe("isSensitiveHeader", () => {
  it("identifies payment header as sensitive", () => {
    expect(isSensitiveHeader("payment")).toBe(true);
    expect(isSensitiveHeader("Payment")).toBe(true);
    expect(isSensitiveHeader("PAYMENT")).toBe(true);
  });

  it("identifies payment-response header as sensitive", () => {
    expect(isSensitiveHeader("payment-response")).toBe(true);
    expect(isSensitiveHeader("Payment-Response")).toBe(true);
    expect(isSensitiveHeader("PAYMENT-RESPONSE")).toBe(true);
  });

  it("identifies authorization header as sensitive", () => {
    expect(isSensitiveHeader("authorization")).toBe(true);
    expect(isSensitiveHeader("Authorization")).toBe(true);
    expect(isSensitiveHeader("AUTHORIZATION")).toBe(true);
  });

  it("returns false for non-sensitive headers", () => {
    expect(isSensitiveHeader("content-type")).toBe(false);
    expect(isSensitiveHeader("x-trace-id")).toBe(false);
    expect(isSensitiveHeader("user-agent")).toBe(false);
  });
});
