// Combined coverage: sponsored idempotency keys and the budget gate.
import test, { describe, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Freighter is a browser extension bridge: faked via the injected signer
// seam, everything else (fetchJson, paidQueryHeaders) is the real composition.
import { runSponsoredPaidQuery } from "./sponsorship.js";
import { resetIdempotencyKeysForTest } from "./idempotency.js";

// All fetch traffic in this file is stubbed; no network access ever happens.
const BASE = "http://localhost:3001";
const PAYER = "G" + "A".repeat(55);
const GRANT_NONCE = "650e8400-e29b-41d4-a716-446655440001";
const GRANT_NONCE_2 = "750e8400-e29b-41d4-a716-446655440002";

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

const originalFetch = globalThis.fetch;
let captured: CapturedRequest[] = [];
let nonceForNextGrant = GRANT_NONCE;

/** Freighter message signer faked through the injection seam. */
const fakeSignMessage = (async () => ({
  signedMessage: "c2lnbmVk",
  error: null
})) as unknown as Parameters<typeof runSponsoredPaidQuery>[0]["signMessageFn"];

function stubFetch() {
  captured = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const requestUrl = String(url);

    if (requestUrl.endsWith("/api/sponsorship/challenge")) {
      return jsonResponse({
        challengeId: "550e8400-e29b-41d4-a716-446655440000",
        wallet: PAYER,
        message: "sign me",
        expiresAt: "2026-12-31T00:00:00.000Z"
      });
    }

    if (requestUrl.endsWith("/api/sponsorship/grants")) {
      return jsonResponse({
        grant: {
          grantId: "550e8400-e29b-41d4-a716-446655440000",
          wallet: PAYER,
          network: "stellar:testnet",
          maxAmountUsd: 1,
          expiresAt: "2026-12-31T00:00:00.000Z",
          nonce: nonceForNextGrant,
          issuedAt: "2026-06-30T12:00:00.000Z"
        },
        signature: "sig"
      });
    }

    if (requestUrl.endsWith("/api/paid/run")) {
      captured.push({ url: requestUrl, init });
      return jsonResponse(sponsoredResponse());
    }

    throw new Error(`Unexpected fetch in test: ${requestUrl}`);
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
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

describe("runSponsoredPaidQuery idempotency key handling", () => {
  beforeEach(() => {
    resetIdempotencyKeysForTest();
    nonceForNextGrant = GRANT_NONCE;
    stubFetch();
  });

  test("a protected fixture sends one key bound to that query and payment", async () => {
    const payload = await runSponsoredPaidQuery({
      apiBaseUrl: BASE,
      mode: "search",
      provider: "search.basic",
      query: "stellar",
      walletAddress: PAYER,
      signMessageFn: fakeSignMessage
    });

    assert.equal(payload.result.traceId, "trace_sponsored");
    assert.equal(captured.length, 1);
    assert.ok(captured[0].url.startsWith(`${BASE}/api/paid/run`));

    const sentKey = headerOf(captured[0].init, "Idempotency-Key");
    assert.match(sentKey ?? "", /^[0-9a-f-]{36}$/, "paid run must carry exactly one key");
    assert.ok(headerNames(captured[0].init).includes("x-sponsorship-grant"));

    // Same query + same payment (grant nonce) re-sends the same single key.
    await runSponsoredPaidQuery({
      apiBaseUrl: BASE,
      mode: "search",
      provider: "search.basic",
      query: "stellar",
      walletAddress: PAYER,
      signMessageFn: fakeSignMessage
    });
    assert.equal(headerOf(captured[1].init, "Idempotency-Key"), sentKey);
  });

  test("a second query sends a different key", async () => {
    await runSponsoredPaidQuery({
      apiBaseUrl: BASE,
      mode: "search",
      provider: "search.basic",
      query: "stellar",
      walletAddress: PAYER,
      signMessageFn: fakeSignMessage
    });
    const firstKey = headerOf(captured[0].init, "Idempotency-Key");

    await runSponsoredPaidQuery({
      apiBaseUrl: BASE,
      mode: "search",
      provider: "search.basic",
      query: "stablecoin micropayments",
      walletAddress: PAYER,
      signMessageFn: fakeSignMessage
    });

    assert.notEqual(headerOf(captured[1].init, "Idempotency-Key"), firstKey);
  });

  test("a different payment (fresh grant nonce) never reuses the previous key", async () => {
    await runSponsoredPaidQuery({
      apiBaseUrl: BASE,
      mode: "search",
      provider: "search.basic",
      query: "stellar",
      walletAddress: PAYER,
      signMessageFn: fakeSignMessage
    });
    const firstKey = headerOf(captured[0].init, "Idempotency-Key");

    nonceForNextGrant = GRANT_NONCE_2;
    await runSponsoredPaidQuery({
      apiBaseUrl: BASE,
      mode: "search",
      provider: "search.basic",
      query: "stellar",
      walletAddress: PAYER,
      signMessageFn: fakeSignMessage
    });

    assert.notEqual(headerOf(captured[1].init, "Idempotency-Key"), firstKey);
  });

  test("sponsored headers never leak to a public path", async () => {
    // Own permissive stub: the strict paid-run stub above throws on
    // unexpected URLs, and this sub-test dispatches a public analytics call.
    globalThis.fetch = (async () =>
      jsonResponse({ ok: true })) as unknown as typeof globalThis.fetch;

    const { fetchJson } = await import("./api.js");
    const analyticsRequest: RequestInit = {
      method: "GET",
      headers: { Accept: "application/json" }
    };

    const data = await fetchJson<{ ok: boolean }>(`${BASE}/api/analytics`, analyticsRequest);
    assert.deepEqual(data, { ok: true });
    assert.equal(headerOf(analyticsRequest, "Idempotency-Key"), null);
    assert.equal(headerOf(analyticsRequest, "X-Sponsorship-Grant"), null);
  });
});

function sponsoredResponse() {
  return {
    traceId: "trace_sponsored",
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
      traceId: "trace_sponsored",
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

import { registerHooks } from "node:module";
import type { SponsorshipPreview } from "@query402/shared";

// Stub @stellar/freighter-api (browser-only) and import.meta.env (Vite-only)
// so sponsorship.ts can be imported in the Node test runner.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@stellar/freighter-api") {
      return {
        url: "data:text/javascript,export const signMessage = async () => ({ error: new Error('stub') });",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (result.source && result.source.includes("import.meta.env")) {
      const source =
        typeof result.source === "string"
          ? result.source
          : Buffer.from(result.source).toString("utf8");
      if (source.includes("import.meta.env")) {
        result.source = source.replaceAll(
          /import\.meta\.env(\.\w+)?/g,
          '({ VITE_API_BASE_URL: "http://localhost:3001" })'
        );
      }
    }
    return result;
  }
});

type BudgetGateModule = typeof import("./sponsorship.js");

let BudgetGate: BudgetGateModule["BudgetGate"];
let evaluateBudgetGate: BudgetGateModule["evaluateBudgetGate"];

before(async () => {
  const mod = await import("./sponsorship.js");
  BudgetGate = mod.BudgetGate;
  evaluateBudgetGate = mod.evaluateBudgetGate;
});

function makePreview(overrides: Partial<SponsorshipPreview> = {}): SponsorshipPreview {
  return {
    sponsorshipEnabled: true,
    storageAvailable: true,
    available: true,
    decision: "allowed",
    network: "stellar:testnet",
    wallet: "GABC123",
    mode: "search",
    provider: "search.basic",
    providerName: "Search Basic",
    grant: {
      maxAmountUsd: 1,
      ttlSeconds: 300,
      expiresInSeconds: 300,
      restrictions: { mode: null, providerId: null }
    },
    quotedPriceUsd: 0.01,
    priceFitsGrant: true,
    perWalletBudget: { limitUsd: 1, spentUsd: 0, remainingUsd: 1, windowStart: "2026-09-30" },
    globalBudget: { limitUsd: 10, spentUsd: 0, remainingUsd: 10, windowStart: "2026-09-30" },
    ...overrides
  };
}

describe("evaluateBudgetGate", () => {
  test("a remaining budget enables the fixture action", () => {
    const preview = makePreview({ available: true, decision: "allowed" });
    const result = evaluateBudgetGate(preview);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, null);
  });

  test("an exhausted budget disables it", () => {
    const preview = makePreview({
      available: false,
      decision: "denied_budget_exceeded",
      reason: "wallet_budget_exceeded",
      perWalletBudget: { limitUsd: 1, spentUsd: 1, remainingUsd: 0, windowStart: "2026-09-30" }
    });
    const result = evaluateBudgetGate(preview);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "wallet_budget_exceeded");
    assert.strictEqual(result.decision, "denied_budget_exceeded");
  });

  test("a policy deny disables it", () => {
    const preview = makePreview({
      available: false,
      decision: "denied_price_exceeded",
      reason: "price_exceeds_grant"
    });
    const result = evaluateBudgetGate(preview);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "price_exceeds_grant");
    assert.strictEqual(result.decision, "denied_price_exceeded");
  });

  test("falls back to decision when reason is missing", () => {
    const preview = makePreview({
      available: false,
      decision: "denied_sponsorship_disabled"
    });
    const result = evaluateBudgetGate(preview);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "denied_sponsorship_disabled");
  });
});

describe("BudgetGate", () => {
  test("a remaining budget enables the fixture action", () => {
    const gate = new BudgetGate();
    const id = gate.beginRequest();
    gate.applyResponse(id, makePreview({ available: true }));
    assert.strictEqual(gate.decision.allowed, true);
  });

  test("an exhausted budget disables it", () => {
    const gate = new BudgetGate();
    const id = gate.beginRequest();
    gate.applyResponse(
      id,
      makePreview({ available: false, decision: "denied_budget_exceeded", reason: "wallet_budget_exceeded" })
    );
    assert.strictEqual(gate.decision.allowed, false);
    assert.strictEqual(gate.decision.reason, "wallet_budget_exceeded");
  });

  test("a policy deny disables it", () => {
    const gate = new BudgetGate();
    const id = gate.beginRequest();
    gate.applyResponse(
      id,
      makePreview({ available: false, decision: "denied_wrong_provider", reason: "unknown_provider" })
    );
    assert.strictEqual(gate.decision.allowed, false);
    assert.strictEqual(gate.decision.reason, "unknown_provider");
  });

  test("an older allow response does not override a newer deny", () => {
    const gate = new BudgetGate();

    // First request: allow
    const firstId = gate.beginRequest();
    // Second request: deny (newer)
    const secondId = gate.beginRequest();

    // The older allow arrives late — it must not re-enable the actions.
    gate.applyResponse(firstId, makePreview({ available: true }));
    assert.strictEqual(gate.decision.allowed, false, "stale allow must not override newer deny");

    // The newer deny arrives and is applied.
    gate.applyResponse(
      secondId,
      makePreview({ available: false, decision: "denied_budget_exceeded", reason: "wallet_budget_exceeded" })
    );
    assert.strictEqual(gate.decision.allowed, false);
    assert.strictEqual(gate.decision.reason, "wallet_budget_exceeded");
  });

  test("an older deny does not override a newer allow", () => {
    const gate = new BudgetGate();

    const firstId = gate.beginRequest();
    const secondId = gate.beginRequest();

    gate.applyResponse(
      firstId,
      makePreview({ available: false, decision: "denied_budget_exceeded", reason: "wallet_budget_exceeded" })
    );
    // Stale deny must not override the newer allow.
    gate.applyResponse(secondId, makePreview({ available: true }));
    assert.strictEqual(gate.decision.allowed, true);
  });

  test("applyError blocks the action and shows the reason", () => {
    const gate = new BudgetGate();
    const id = gate.beginRequest();
    gate.applyError(id, "Grant preview unavailable");
    assert.strictEqual(gate.decision.allowed, false);
    assert.strictEqual(gate.decision.reason, "Grant preview unavailable");
  });

  test("stale error does not override a newer response", () => {
    const gate = new BudgetGate();

    const firstId = gate.beginRequest();
    const secondId = gate.beginRequest();

    gate.applyError(firstId, "Grant preview unavailable");
    gate.applyResponse(secondId, makePreview({ available: true }));
    assert.strictEqual(gate.decision.allowed, true);
  });

  test("reset clears the gate", () => {
    const gate = new BudgetGate();
    const id = gate.beginRequest();
    gate.applyResponse(id, makePreview({ available: true }));
    assert.strictEqual(gate.decision.allowed, true);

    gate.reset();
    assert.strictEqual(gate.decision.allowed, false);
    assert.strictEqual(gate.decision.reason, null);
  });
});
