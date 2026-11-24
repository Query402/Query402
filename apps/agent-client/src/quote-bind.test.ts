import { describe, expect, it, vi } from "vitest";
import { USDC_TESTNET_ADDRESS, convertToTokenAmount } from "@x402/stellar";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import {
  assertChallengeMatchesQuote,
  buildRequestedQuote,
  extractChallengeFromPaymentRequired,
  QuoteBindError
} from "./quote-bind.js";
import { fetchWithQuoteBoundPayment } from "./client.js";
import { x402Client } from "@x402/core/client";

const NETWORK = "stellar:testnet";
const ASSET = USDC_TESTNET_ADDRESS;
const PROVIDER = "search.basic";
const PRICE_USD = 0.01;
const AMOUNT = convertToTokenAmount(PRICE_USD.toFixed(7));

const exactQuote = buildRequestedQuote({
  provider: PROVIDER,
  priceUsd: PRICE_USD,
  network: NETWORK,
  asset: ASSET
});

function buildPaymentRequired(overrides: {
  amount?: string;
  asset?: string;
  network?: string;
  provider?: string;
  expiresAt?: string;
  emptyAccepts?: boolean;
}) {
  if (overrides.emptyAccepts) {
    return {
      x402Version: 2,
      resource: { url: "http://localhost:3001/x402/search", description: "search", mimeType: "application/json" },
      accepts: []
    };
  }

  return {
    x402Version: 2,
    resource: {
      url: "http://localhost:3001/x402/search?provider=search.basic",
      description: "search",
      mimeType: "application/json"
    },
    accepts: [
      {
        scheme: "exact",
        network: overrides.network ?? NETWORK,
        asset: overrides.asset ?? ASSET,
        amount: overrides.amount ?? AMOUNT,
        payTo: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        maxTimeoutSeconds: 60,
        extra: {
          provider: overrides.provider ?? PROVIDER,
          ...(overrides.expiresAt ? { expiresAt: overrides.expiresAt } : {})
        }
      }
    ]
  };
}

function challengeResponse(paymentRequired: unknown) {
  const header = encodePaymentRequiredHeader(paymentRequired as never);
  return new Response(JSON.stringify({ error: "Payment Required" }), {
    status: 402,
    headers: {
      "content-type": "application/json",
      "PAYMENT-REQUIRED": header
    }
  });
}

describe("quote-bind helpers", () => {
  it("builds a requested quote from catalog price and network defaults", () => {
    expect(exactQuote).toEqual({
      provider: PROVIDER,
      amount: AMOUNT,
      asset: ASSET,
      network: NETWORK
    });
  });

  it("extracts provider and expiry from challenge extras", () => {
    const paymentRequired = buildPaymentRequired({
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    expect(extractChallengeFromPaymentRequired(paymentRequired)).toEqual({
      provider: PROVIDER,
      amount: AMOUNT,
      asset: ASSET,
      network: NETWORK,
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
  });

  it("accepts an exact challenge", () => {
    const challenge = extractChallengeFromPaymentRequired(buildPaymentRequired({}));
    expect(() => assertChallengeMatchesQuote(exactQuote, challenge)).not.toThrow();
  });

  it("rejects a different amount without exposing header bytes", () => {
    const challenge = extractChallengeFromPaymentRequired(
      buildPaymentRequired({ amount: convertToTokenAmount("0.0200000") })
    );
    try {
      assertChallengeMatchesQuote(exactQuote, challenge);
      expect.unreachable("expected QuoteBindError");
    } catch (error) {
      expect(error).toBeInstanceOf(QuoteBindError);
      expect((error as QuoteBindError).code).toBe("challenge_mismatch");
      expect(JSON.stringify(error)).not.toMatch(/PAYMENT-REQUIRED|payment-required/i);
      expect((error as Error).message).not.toMatch(/CBIELTK6|AAAAA/);
    }
  });

  it("rejects an expired challenge", () => {
    const challenge = extractChallengeFromPaymentRequired(
      buildPaymentRequired({ expiresAt: "2020-01-01T00:00:00.000Z" })
    );
    expect(() => assertChallengeMatchesQuote(exactQuote, challenge, Date.parse("2026-01-01T00:00:00.000Z")))
      .toThrow(QuoteBindError);
    try {
      assertChallengeMatchesQuote(exactQuote, challenge, Date.parse("2026-01-01T00:00:00.000Z"));
    } catch (error) {
      expect((error as QuoteBindError).code).toBe("challenge_expired");
    }
  });

  it("rejects an empty challenge", () => {
    expect(() => assertChallengeMatchesQuote(exactQuote, null)).toThrow(QuoteBindError);
    expect(extractChallengeFromPaymentRequired(buildPaymentRequired({ emptyAccepts: true }))).toBeNull();
  });
});

describe("fetchWithQuoteBoundPayment / runPaidQuery quote binding", () => {
  it("pays an exact challenge fixture and invokes the wallet/payment stub once", async () => {
    const paymentRequired = buildPaymentRequired({
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const sign = vi.fn().mockResolvedValue({ "PAYMENT-SIGNATURE": "signed-fixture" });
    let calls = 0;
    const fetchStub = vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes("/api/providers")) {
        return new Response(
          JSON.stringify({
            providers: [{ id: PROVIDER, priceUsd: PRICE_USD, enabled: true }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      calls += 1;
      if (calls === 1) {
        return challengeResponse(paymentRequired);
      }
      return new Response(JSON.stringify({ ok: true, result: { priceUsd: PRICE_USD } }), {
        status: 200,
        headers: { "content-type": "application/json", "payment-response": "demo" }
      });
    });

    process.env.DEMO_MODE = "false";
    process.env.DEMO_CLIENT_SECRET_KEY = "S".padEnd(56, "A");
    process.env.API_BASE_URL = "http://localhost:3001";
    process.env.STELLAR_NETWORK = NETWORK;
    process.env.X402_ASSET = ASSET;
    vi.resetModules();

    const { runPaidQuery: run } = await import("./client.js");
    const result = await run(
      { mode: "search", provider: PROVIDER, query: "stellar" },
      {
        fetch: fetchStub as unknown as typeof fetch,
        quote: exactQuote,
        createWallet: () => ({
          address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          signAuthEntry: async () => {
            throw new Error("wallet should not be used when createPaymentHeaders is stubbed");
          }
        }),
        createPaymentHeaders: async () => {
          await sign();
          return { "PAYMENT-SIGNATURE": "signed-fixture" };
        }
      }
    );

    expect(sign).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.quote).toEqual(exactQuote);
  });

  it("does not sign when the challenge amount differs", async () => {
    const paymentRequired = buildPaymentRequired({
      amount: convertToTokenAmount("0.0500000"),
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const sign = vi.fn().mockResolvedValue({ "PAYMENT-SIGNATURE": "should-not-sign" });
    const fetchStub = vi.fn(async () => challengeResponse(paymentRequired));

    const client = new x402Client();
    await expect(
      fetchWithQuoteBoundPayment(
        "http://localhost:3001/x402/search?provider=search.basic&q=stellar",
        { method: "GET" },
        exactQuote,
        {
          fetch: fetchStub as unknown as typeof fetch,
          client,
          createPaymentHeaders: async () => {
            await sign();
            return { "PAYMENT-SIGNATURE": "should-not-sign" };
          }
        }
      )
    ).rejects.toMatchObject({ code: "challenge_mismatch", name: "QuoteBindError" });

    expect(sign).not.toHaveBeenCalled();
  });

  it("does not sign when the challenge is expired", async () => {
    const paymentRequired = buildPaymentRequired({
      expiresAt: "2020-06-01T00:00:00.000Z"
    });
    const sign = vi.fn();
    const fetchStub = vi.fn(async () => challengeResponse(paymentRequired));
    const client = new x402Client();

    await expect(
      fetchWithQuoteBoundPayment(
        "http://localhost:3001/x402/search?provider=search.basic&q=stellar",
        { method: "GET" },
        exactQuote,
        {
          fetch: fetchStub as unknown as typeof fetch,
          client,
          createPaymentHeaders: async () => {
            sign();
            return { "PAYMENT-SIGNATURE": "should-not-sign" };
          },
          nowMs: Date.parse("2026-01-01T00:00:00.000Z")
        }
      )
    ).rejects.toMatchObject({ code: "challenge_expired", name: "QuoteBindError" });

    expect(sign).not.toHaveBeenCalled();
  });

  it("does not sign an empty challenge and omits raw header from the error", async () => {
    const sign = vi.fn();
    const fetchStub = vi.fn(
      async () =>
        new Response("{}", {
          status: 402,
          headers: { "content-type": "application/json" }
        })
    );
    const client = new x402Client();

    try {
      await fetchWithQuoteBoundPayment(
        "http://localhost:3001/x402/search?provider=search.basic&q=stellar",
        { method: "GET" },
        exactQuote,
        {
          fetch: fetchStub as unknown as typeof fetch,
          client,
          createPaymentHeaders: async () => {
            sign();
            return { "PAYMENT-SIGNATURE": "should-not-sign" };
          }
        }
      );
      expect.unreachable("expected QuoteBindError");
    } catch (error) {
      expect(error).toBeInstanceOf(QuoteBindError);
      expect((error as QuoteBindError).code).toBe("challenge_empty");
      expect(JSON.stringify(error)).not.toMatch(/PAYMENT-REQUIRED/i);
    }

    expect(sign).not.toHaveBeenCalled();
  });
});
