import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// All fetch traffic in this file is stubbed; no network access ever happens.
import { fetchJson, isPaidProtectedPath, paidQueryHeaders, assertNoPaymentHeaders } from "./api.js";
import { resetIdempotencyKeysForTest } from "./idempotency.js";

const BASE = "http://localhost:3001";
const PROTECTED_SEARCH_URL = `${BASE}/x402/search?provider=search.basic&q=stellar`;
const PUBLIC_ANALYTICS_URL = `${BASE}/api/analytics`;
const PAYER = "G" + "A".repeat(55);

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

const originalFetch = globalThis.fetch;
let captured: CapturedRequest[] = [];

function stubFetch(status = 200, body: unknown = { ok: true }) {
  captured = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

describe("isPaidProtectedPath", () => {
  test("classifies x402 and paid-run routes as protected", () => {
    assert.equal(isPaidProtectedPath("/x402/search"), true);
    assert.equal(isPaidProtectedPath("/x402/news"), true);
    assert.equal(isPaidProtectedPath("/x402/scrape"), true);
    assert.equal(isPaidProtectedPath("/x402/analytics/detailed"), true);
    assert.equal(isPaidProtectedPath("/api/paid/run"), true);
  });

  test("classifies public routes as not protected", () => {
    assert.equal(isPaidProtectedPath("/health"), false);
    assert.equal(isPaidProtectedPath("/api/providers"), false);
    assert.equal(isPaidProtectedPath("/api/analytics"), false);
    assert.equal(isPaidProtectedPath("/api/sponsorship/challenge"), false);
  });

  test("uses the route path only, ignoring query and scheme/host", () => {
    assert.equal(isPaidProtectedPath(`${BASE}/x402/search?provider=search.basic&q=stellar`), true);
    assert.equal(isPaidProtectedPath(`${BASE}/api/providers?next=/x402/search`), false);
  });
});

describe("paidQueryHeaders", () => {
  beforeEach(() => {
    resetIdempotencyKeysForTest();
  });

  test("a protected fixture sends exactly one key bound to that query", () => {
    stubFetch();
    const headers = paidQueryHeaders({
      requestUrl: PROTECTED_SEARCH_URL,
      mode: "search",
      provider: "search.basic",
      query: "stellar",
      paymentReference: PAYER
    });

    assert.deepEqual(Object.keys(headers), ["Idempotency-Key"]);

    // The same logical request re-sends the same single key.
    const headersAgain = paidQueryHeaders({
      requestUrl: PROTECTED_SEARCH_URL,
      mode: "search",
      provider: "search.basic",
      query: "stellar",
      paymentReference: PAYER
    });
    assert.equal(headersAgain["Idempotency-Key"], headers["Idempotency-Key"]);

    // The key actually goes out on the wire for the protected route.
    void fetch(PROTECTED_SEARCH_URL, { method: "GET", headers });
    assert.equal(captured.length, 1);
    assert.equal(headerOf(captured[0].init, "Idempotency-Key"), headers["Idempotency-Key"]);
  });

  test("a second query sends a different key", () => {
    const first = paidQueryHeaders({
      requestUrl: PROTECTED_SEARCH_URL,
      mode: "search",
      provider: "search.basic",
      query: "stellar",
      paymentReference: PAYER
    });
    const second = paidQueryHeaders({
      requestUrl: PROTECTED_SEARCH_URL,
      mode: "search",
      provider: "search.basic",
      query: "stablecoin micropayments",
      paymentReference: PAYER
    });

    assert.notEqual(second["Idempotency-Key"], first["Idempotency-Key"]);
  });

  test("a different provider or payment reference also changes the key", () => {
    const base = paidQueryHeaders({
      requestUrl: PROTECTED_SEARCH_URL,
      mode: "search",
      provider: "search.basic",
      query: "stellar",
      paymentReference: PAYER
    });

    const otherProvider = paidQueryHeaders({
      requestUrl: PROTECTED_SEARCH_URL,
      mode: "search",
      provider: "search.premium",
      query: "stellar",
      paymentReference: PAYER
    });
    const otherPayment = paidQueryHeaders({
      requestUrl: PROTECTED_SEARCH_URL,
      mode: "search",
      provider: "search.basic",
      query: "stellar",
      paymentReference: "G" + "B".repeat(55)
    });

    assert.notEqual(otherProvider["Idempotency-Key"], base["Idempotency-Key"]);
    assert.notEqual(otherPayment["Idempotency-Key"], base["Idempotency-Key"]);
  });

  test("refuses to issue a key for a public path", () => {
    assert.throws(
      () =>
        paidQueryHeaders({
          requestUrl: PUBLIC_ANALYTICS_URL,
          mode: "search",
          provider: "search.basic",
          query: "stellar",
          paymentReference: PAYER
        }),
      /non-protected path/
    );
  });
});

describe("assertNoPaymentHeaders", () => {
  test("allows payment headers on a protected path", () => {
    assert.doesNotThrow(() =>
      assertNoPaymentHeaders(PROTECTED_SEARCH_URL, { "X-Sponsorship-Grant": "grant" })
    );
  });

  test("refuses any payment header on a public path", () => {
    for (const header of ["X-Sponsorship-Grant", "Idempotency-Key", "X-Payment", "x402-payment"]) {
      assert.throws(
        () => assertNoPaymentHeaders(PUBLIC_ANALYTICS_URL, { [header]: "value" }),
        new RegExp(`Refusing to send payment header "${header.toLowerCase()}"`),
        `expected ${header} to be rejected`
      );
    }
  });
});

describe("fetchJson guard", () => {
  beforeEach(() => {
    resetIdempotencyKeysForTest();
  });

  test("a public request has no payment header and is dispatched untouched", async () => {
    stubFetch(200, { totalQueries: 0 });
    const data = await fetchJson<{ totalQueries: number }>(PUBLIC_ANALYTICS_URL, {
      method: "GET",
      headers: { Accept: "application/json" }
    });

    assert.equal(data.totalQueries, 0);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, PUBLIC_ANALYTICS_URL);
    assert.equal(headerOf(captured[0].init, "Idempotency-Key"), null);
    assert.equal(headerOf(captured[0].init, "X-Sponsorship-Grant"), null);
    assert.equal(headerOf(captured[0].init, "X-Payment"), null);
  });

  test("a public request carrying payment headers never reaches fetch", async () => {
    stubFetch();
    await assert.rejects(
      fetchJson(PUBLIC_ANALYTICS_URL, {
        method: "GET",
        headers: { "Idempotency-Key": "leaky-key", "X-Sponsorship-Grant": "leaky-grant" }
      }),
      /Refusing to send payment header/
    );
    assert.equal(
      captured.length,
      0,
      "fetch must not be called with payment headers on a public path"
    );
  });

  test("payment headers are permitted on a protected path", async () => {
    stubFetch(200, { traceId: "trace_1" });
    const data = await fetchJson<{ traceId: string }>(PROTECTED_SEARCH_URL, {
      method: "GET",
      headers: {
        "Idempotency-Key": "protected-key",
        "X-Sponsorship-Grant": "protected-grant"
      }
    });

    assert.equal(data.traceId, "trace_1");
    assert.equal(captured.length, 1);
    assert.equal(headerOf(captured[0].init, "Idempotency-Key"), "protected-key");
  });
});
