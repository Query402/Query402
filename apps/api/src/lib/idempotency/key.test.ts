import type { Request } from "express";
import { MAX_IDEMPOTENCY_KEY_BYTES } from "@query402/shared";
import { describe, expect, it } from "vitest";
import { INVALID_IDEMPOTENCY_KEY_BODY, validateIdempotencyKey } from "./key.js";

type Header = [name: string, value: string];

function requestWithHeaders(headers: Header[]): Request {
  return {
    rawHeaders: headers.flatMap(([name, value]) => [name, value]),
    get(name: string) {
      const values = headers
        .filter(([headerName]) => headerName.toLowerCase() === name.toLowerCase())
        .map(([, value]) => value);
      return values.length > 0 ? values.join(", ") : undefined;
    }
  } as unknown as Request;
}

describe("Idempotency-Key validation", () => {
  it("allows a request without the header", () => {
    expect(validateIdempotencyKey(requestWithHeaders([]))).toEqual({
      valid: true,
      key: undefined
    });
  });

  it("accepts a key of exactly the documented maximum byte length", () => {
    const key = "k".repeat(MAX_IDEMPOTENCY_KEY_BYTES);

    expect(validateIdempotencyKey(requestWithHeaders([["Idempotency-Key", key]]))).toEqual({
      valid: true,
      key
    });
  });

  it("rejects a key one byte over the documented maximum length", () => {
    const key = "k".repeat(MAX_IDEMPOTENCY_KEY_BYTES + 1);

    expect(validateIdempotencyKey(requestWithHeaders([["Idempotency-Key", key]]))).toEqual({
      valid: false,
      key: undefined
    });
  });

  it("measures the limit in bytes, not JavaScript code units", () => {
    // U+00E9 is two UTF-8 bytes, so this is exactly at the byte limit while
    // being half the limit in UTF-16 code units.
    const atLimit = "\u00e9".repeat(MAX_IDEMPOTENCY_KEY_BYTES / 2);
    expect(validateIdempotencyKey(requestWithHeaders([["Idempotency-Key", atLimit]]))).toEqual({
      valid: true,
      key: atLimit
    });

    const overLimit = "\u00e9".repeat(MAX_IDEMPOTENCY_KEY_BYTES / 2 + 1);
    expect(validateIdempotencyKey(requestWithHeaders([["Idempotency-Key", overLimit]]))).toEqual({
      valid: false,
      key: undefined
    });
  });

  it("enforces the wire length before trimming", () => {
    // The trimmed value fits, but the value as received is over the byte limit.
    const padded = `  ${"k".repeat(MAX_IDEMPOTENCY_KEY_BYTES)}  `;

    expect(validateIdempotencyKey(requestWithHeaders([["Idempotency-Key", padded]]))).toEqual({
      valid: false,
      key: undefined
    });
  });

  it("trims surrounding whitespace when the raw value is within the byte limit", () => {
    const key = "k".repeat(MAX_IDEMPOTENCY_KEY_BYTES - 4);

    expect(validateIdempotencyKey(requestWithHeaders([["idempotency-key", `  ${key}  `]]))).toEqual(
      { valid: true, key }
    );
  });

  it("rejects empty and whitespace-only values", () => {
    for (const value of ["", "   "]) {
      expect(validateIdempotencyKey(requestWithHeaders([["Idempotency-Key", value]]))).toEqual({
        valid: false,
        key: undefined
      });
    }
  });

  it("rejects repeated headers regardless of casing", () => {
    const result = validateIdempotencyKey(
      requestWithHeaders([
        ["Idempotency-Key", "first-key"],
        ["idempotency-key", "second-key"]
      ])
    );

    expect(result).toEqual({ valid: false, key: undefined });
  });

  it("falls back to the joined header value when rawHeaders is unavailable", () => {
    const request = {
      rawHeaders: undefined,
      get: (name: string) => (name.toLowerCase() === "idempotency-key" ? "fallback-key" : undefined)
    } as unknown as Request;

    expect(validateIdempotencyKey(request)).toEqual({ valid: true, key: "fallback-key" });
  });

  it("exposes one stable error body for every invalid shape", () => {
    expect(INVALID_IDEMPOTENCY_KEY_BODY).toEqual({
      error: "Invalid Idempotency-Key header",
      type: "invalid_idempotency_key",
      errorCode: "invalid_idempotency_key"
    });
  });
});
