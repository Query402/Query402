import { describe, expect, it } from "vitest";
import {
  isSensitiveHeader,
  redactSensitiveHeaders,
  redactSensitiveObject
} from "./redact-headers.js";
import { redactLoggerHeaders } from "./logger.js";
import { buildPaymentDebugMetadata } from "./payment-debug.js";

const FIXTURE_PAYMENT_SECRET = "fixture-payment-secret-123";

describe("header redaction at output helpers", () => {
  const headers = {
    Authorization: `Bearer ${FIXTURE_PAYMENT_SECRET}`,
    Payment: FIXTURE_PAYMENT_SECRET,
    Cookie: `session=${FIXTURE_PAYMENT_SECRET}`,
    "X-Request-Id": "req-456"
  };

  it("redacts headers before the logger serializes an error log", () => {
    const logPayload = {
      headers: redactLoggerHeaders(headers),
      statusCode: 402
    };
    const output = JSON.stringify(logPayload);

    expect(output).not.toContain(FIXTURE_PAYMENT_SECRET);
    expect(output).toContain("Authorization");
    expect(output).toContain("Payment");
    expect(output).toContain("Cookie");
    expect(logPayload.statusCode).toBe(402);
  });

  it("redacts headers in payment debug metadata and preserves status", () => {
    const debug = buildPaymentDebugMetadata({
      failureType: "invalid_payment_header",
      route: "/x402/search",
      providerId: "search.basic",
      expectedPrice: "$0.01",
      headers,
      statusCode: 402
    });
    const output = JSON.stringify(debug);

    expect(output).not.toContain(FIXTURE_PAYMENT_SECRET);
    expect(debug.headers).toHaveProperty("Authorization", "[REDACTED]");
    expect(debug.headers).toHaveProperty("Payment", "[REDACTED]");
    expect(debug.headers).toHaveProperty("Cookie", "[REDACTED]");
    expect(debug.statusCode).toBe(402);
  });
});

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

  it("redacts cookie headers while preserving their names", () => {
    const result = redactSensitiveHeaders({
      Cookie: "session=fixture-payment-secret",
      "Set-Cookie": "token=fixture-payment-secret",
      "X-Request-Id": "req-456"
    });

    expect(result).toEqual({
      Cookie: "[REDACTED]",
      "Set-Cookie": "[REDACTED]",
      "X-Request-Id": "req-456"
    });
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

  it("redacts nested payment payload fields while preserving request identifiers", () => {
    const payload = {
      authorization: "Bearer secret-token-12345",
      payment: {
        signature: "sig-super-secret",
        proof: "proof-abc",
        amount: "0.01"
      },
      traceId: "trace-123",
      xRequestId: "req-456",
      xPaymentAttemptId: "pay_abc123",
      meta: {
        paymentResponse: "response-blob",
        nestedSignature: "nested-signature-secret",
        requestId: "meta-req-789"
      }
    };

    const result = redactSensitiveObject(payload);

    expect(result.authorization).toBe("[REDACTED]");
    expect(result.payment).toEqual({
      signature: "[REDACTED]",
      proof: "[REDACTED]",
      amount: "0.01"
    });
    expect(result.traceId).toBe("trace-123");
    expect(result.xRequestId).toBe("req-456");
    expect(result.xPaymentAttemptId).toBe("pay_abc123");
    expect(result.meta.paymentResponse).toBe("[REDACTED]");
    expect(result.meta.nestedSignature).toBe("[REDACTED]");
    expect(result.meta.requestId).toBe("meta-req-789");
    expect(JSON.stringify(result)).not.toContain("secret-token-12345");
    expect(JSON.stringify(result)).not.toContain("sig-super-secret");
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

  it("identifies cookie headers as sensitive", () => {
    expect(isSensitiveHeader("cookie")).toBe(true);
    expect(isSensitiveHeader("Set-Cookie")).toBe(true);
  });

  it("returns false for non-sensitive headers", () => {
    expect(isSensitiveHeader("content-type")).toBe(false);
    expect(isSensitiveHeader("x-trace-id")).toBe(false);
    expect(isSensitiveHeader("user-agent")).toBe(false);
  });
});
