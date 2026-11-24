import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { normalizeQueryUrl } from "@query402/shared";
import {
  buildPaidRequestKey,
  getIdempotencyKey,
  resetIdempotencyKeysForTest
} from "./idempotency.js";

const PAYER = "G" + "A".repeat(55);

function requestKeyFor(overrides: Partial<Parameters<typeof buildPaidRequestKey>[0]> = {}): string {
  return buildPaidRequestKey({
    route: "/x402/search",
    mode: "search",
    provider: "search.basic",
    query: "stellar",
    paymentReference: PAYER,
    ...overrides
  });
}

beforeEach(() => {
  resetIdempotencyKeysForTest();
});

describe("buildPaidRequestKey", () => {
  test("binds the key to the provider, the query, and the payment reference", () => {
    const key = JSON.parse(requestKeyFor());

    assert.equal(key.route, "/x402/search");
    assert.equal(key.provider, "search.basic");
    assert.deepEqual(key.input, { q: "stellar" });
    assert.equal(key.paymentReference, PAYER);
  });

  test("a different query produces a different request identity", () => {
    assert.notEqual(
      requestKeyFor({ query: "stellar" }),
      requestKeyFor({ query: "stablecoin micropayments" })
    );
  });

  test("a different provider or payment reference produces a different identity", () => {
    assert.notEqual(
      requestKeyFor({ provider: "search.basic" }),
      requestKeyFor({ provider: "search.premium" })
    );
    assert.notEqual(
      requestKeyFor({ paymentReference: PAYER }),
      requestKeyFor({ paymentReference: "G" + "B".repeat(55) })
    );
  });

  test("equivalent queries produce the same identity (safe retries)", () => {
    assert.equal(requestKeyFor({ query: "  stellar  " }), requestKeyFor({ query: "stellar" }));
  });

  test("scrape mode normalizes equivalent URLs into one identity", () => {
    assert.equal(
      buildPaidRequestKey({
        route: "/x402/scrape",
        mode: "scrape",
        provider: "scrape.page",
        url: "HTTPS://Example.COM/reports/",
        paymentReference: PAYER
      }),
      buildPaidRequestKey({
        route: "/x402/scrape",
        mode: "scrape",
        provider: "scrape.page",
        url: "https://example.com/reports",
        paymentReference: PAYER
      })
    );
    assert.equal(normalizeQueryUrl("https://example.com/reports/"), "https://example.com/reports");
  });

  test("scrape and search inputs never collide across routes", () => {
    assert.notEqual(
      buildPaidRequestKey({
        route: "/x402/scrape",
        mode: "scrape",
        provider: "scrape.page",
        url: "https://example.com",
        paymentReference: PAYER
      }),
      requestKeyFor({ route: "/x402/search" })
    );
  });

  test("requires the mode-appropriate input", () => {
    assert.throws(
      () => buildPaidRequestKey({ mode: "scrape", query: "stellar", paymentReference: PAYER }),
      /url is required/
    );
    assert.throws(
      () => buildPaidRequestKey({ mode: "search", paymentReference: PAYER }),
      /query is required/
    );
  });
});

describe("getIdempotencyKey", () => {
  test("returns a stable UUID per request identity", () => {
    const requestKey = requestKeyFor();
    const first = getIdempotencyKey(requestKey);
    const second = getIdempotencyKey(requestKey);

    assert.match(first, /^[0-9a-f-]{36}$/);
    assert.equal(second, first);
  });

  test("a different request identity gets a different key", () => {
    const first = getIdempotencyKey(requestKeyFor({ query: "a" }));
    const second = getIdempotencyKey(requestKeyFor({ query: "b" }));

    assert.notEqual(second, first);
  });

  test("reset clears the mapping so a fresh key is minted", () => {
    const requestKey = requestKeyFor();
    const first = getIdempotencyKey(requestKey);
    resetIdempotencyKeysForTest();
    const second = getIdempotencyKey(requestKey);

    assert.notEqual(second, first);
  });
});
