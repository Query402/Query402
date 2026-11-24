import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runWalletPaidQuery } from "./x402.js";
import { resetIdempotencyKeysForTest } from "./idempotency.js";
import type { WalletSessionMachine } from "./wallet/index.js";
import type { WalletState } from "./wallet/types.js";

// All fetch traffic in this file is stubbed; no network access ever happens.
const BASE = "http://localhost:3001";
const PAYER = "G" + "A".repeat(55);

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

const originalFetch = globalThis.fetch;
let captured: CapturedRequest[] = [];
let nextBody: unknown = { ok: true };

function stubFetch() {
  captured = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    // The x402 wrapper may dispatch a Request object instead of (url, init);
    // normalize so assertions always see the effective url and headers.
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    captured.push({ url, init: { headers } });
    return new Response(JSON.stringify(nextBody), {
      status: 200,
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

function headerNames(init: RequestInit | undefined): string[] {
  return [...new Headers(init?.headers).keys()];
}

/** A minimal in-memory wallet machine: connected signer, no Freighter needed. */
function fakeWallet(): WalletSessionMachine {
  const state: WalletState = { status: "connected", address: PAYER };
  return {
    getState: () => state,
    signAuthEntry: async (authEntryXdr: string) => ({
      signedAuthEntry: authEntryXdr,
      signerAddress: PAYER
    }),
    signTransaction: async (xdr: string) => ({ signedTxXdr: xdr, signerAddress: PAYER })
  } as unknown as WalletSessionMachine;
}

/**
 * runWalletPaidQuery wraps globalThis.fetch with @x402/fetch, so stubbing
 * globalThis.fetch exercises the real wrapping. A 200 response passes through
 * the wrapper without any payment creation or network I/O.
 */
function runPaidQuery(input: { query?: string; url?: string; mode: "search" | "news" | "scrape" }) {
  return runWalletPaidQuery({
    apiBaseUrl: BASE,
    mode: input.mode,
    provider: input.mode === "scrape" ? "scrape.page" : "search.basic",
    query: input.query,
    url: input.url,
    wallet: fakeWallet()
  });
}

describe("runWalletPaidQuery idempotency key handling", () => {
  beforeEach(() => {
    resetIdempotencyKeysForTest();
    stubFetch();
    nextBody = { ok: true };
  });

  test("a protected fixture sends one key bound to that query", async () => {
    nextBody = walletResponse();
    const payload = await runPaidQuery({ mode: "search", query: "stellar" });

    assert.equal(payload.result.traceId, "trace_wallet");
    assert.equal(captured.length, 1);
    assert.ok(captured[0].url.startsWith(`${BASE}/x402/search?provider=search.basic`));

    const sentKey = headerOf(captured[0].init, "Idempotency-Key");
    assert.match(sentKey ?? "", /^[0-9a-f-]{36}$/, "protected request must carry exactly one key");
    assert.deepEqual(headerNames(captured[0].init), ["idempotency-key"]);

    // The same logical request re-sends the same single key (safe retry).
    captured = [];
    nextBody = walletResponse();
    await runPaidQuery({ mode: "search", query: "stellar" });
    assert.equal(captured.length, 1);
    assert.equal(headerOf(captured[0].init, "Idempotency-Key"), sentKey);
  });

  test("a second query sends a different key", async () => {
    nextBody = walletResponse();
    await runPaidQuery({ mode: "search", query: "stellar" });
    const firstKey = headerOf(captured[0].init, "Idempotency-Key");

    captured = [];
    nextBody = walletResponse();
    await runPaidQuery({ mode: "search", query: "stablecoin micropayments" });
    const secondKey = headerOf(captured[0].init, "Idempotency-Key");

    assert.notEqual(secondKey, firstKey);
  });

  test("a public request has no payment header", async () => {
    // The wallet flow only ever targets protected routes; the shared guard is
    // what keeps payment material off public paths. Drive a public dispatch
    // through the same fetchJson guard the flow relies on.
    const { fetchJson } = await import("./api.js");
    const data = await fetchJson<{ ok: boolean }>(`${BASE}/api/analytics`, {
      method: "GET",
      headers: { Accept: "application/json" }
    });

    assert.deepEqual(data, { ok: true });
    assert.equal(headerOf(captured[0].init, "Idempotency-Key"), null);
    assert.equal(headerOf(captured[0].init, "X-Payment"), null);
    assert.equal(headerOf(captured[0].init, "X-Sponsorship-Grant"), null);
  });

  test("scrape mode binds the key to the normalized target URL", async () => {
    nextBody = walletResponse();
    await runPaidQuery({ mode: "scrape", url: "https://example.com/reports" });
    const firstKey = headerOf(captured[0].init, "Idempotency-Key");

    // Equivalent URL (casing/trailing slash) reuses the same key...
    captured = [];
    nextBody = walletResponse();
    await runPaidQuery({ mode: "scrape", url: "HTTPS://Example.COM/reports/" });
    assert.equal(headerOf(captured[0].init, "Idempotency-Key"), firstKey);

    // ...while a different URL mints a different one.
    captured = [];
    nextBody = walletResponse();
    await runPaidQuery({ mode: "scrape", url: "https://example.com/invoices" });
    assert.notEqual(headerOf(captured[0].init, "Idempotency-Key"), firstKey);
  });
});

function walletResponse() {
  return {
    traceId: "trace_wallet",
    payment: {
      network: "stellar:testnet",
      facilitatorUrl: "https://facilitator.example",
      evidence: { kind: "demo", status: "demo-paid", network: "stellar:testnet" }
    },
    result: {
      mode: "search",
      providerId: "search.basic",
      providerName: "Basic Search",
      priceUsd: 0.01,
      latencyMs: 5,
      timestamp: "2026-06-30T12:00:00.000Z",
      traceId: "trace_wallet",
      items: [],
      source: "deterministic-fallback",
      execution: {
        providerId: "search.basic",
        source: "deterministic-fallback",
        usedFallback: true,
        fallbackReason: "test",
        latencyEstimateMs: 5,
        observedDurationMs: 5,
        circuitBreakerState: "closed"
      }
    }
  };
}
