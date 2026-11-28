import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USDC_TESTNET_ADDRESS, convertToTokenAmount } from "@x402/stellar";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { x402Client } from "@x402/core/client";
import { buildRequestedQuote } from "./quote-bind.js";
import { fetchWithQuoteBoundPayment, PaidRedirectError } from "./client.js";

const NETWORK = "stellar:testnet";
const ASSET = USDC_TESTNET_ADDRESS;
const PROVIDER = "search.basic";
const PRICE_USD = 0.01;
const AMOUNT = convertToTokenAmount(PRICE_USD.toFixed(7));
const PAYMENT_HEADER_VALUE = "signed-payment-fixture-secret-value";
const ENDPOINT = "http://localhost:3001/x402/search?provider=search.basic&q=stellar";

const exactQuote = buildRequestedQuote({
  provider: PROVIDER,
  priceUsd: PRICE_USD,
  network: NETWORK,
  asset: ASSET
});

function buildPaymentRequired() {
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
        network: NETWORK,
        asset: ASSET,
        amount: AMOUNT,
        payTo: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        maxTimeoutSeconds: 60,
        extra: {
          provider: PROVIDER,
          expiresAt: "2099-01-01T00:00:00.000Z"
        }
      }
    ]
  };
}

function challengeResponse() {
  const header = encodePaymentRequiredHeader(buildPaymentRequired() as never);
  return new Response(JSON.stringify({ error: "Payment Required" }), {
    status: 402,
    headers: {
      "content-type": "application/json",
      "PAYMENT-REQUIRED": header
    }
  });
}

describe("buildPaidQueryEndpoint", () => {
  beforeEach(() => {
    process.env.API_BASE_URL = "http://localhost:3001";
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function loadClient() {
    const module = await import("./client.js");
    return module.buildPaidQueryEndpoint;
  }

  it("builds search and news URLs with encoded query parameters", async () => {
    const buildPaidQueryEndpoint = await loadClient();

    expect(
      buildPaidQueryEndpoint({
        mode: "search",
        provider: "search.basic",
        query: "latest stellar x402 updates"
      })
    ).toBe("http://localhost:3001/x402/search?provider=search.basic&q=latest+stellar+x402+updates");

    expect(
      buildPaidQueryEndpoint({
        mode: "news",
        provider: "news.fast",
        query: "stablecoin micropayments"
      })
    ).toBe("http://localhost:3001/x402/news?provider=news.fast&q=stablecoin+micropayments");
  });

  it("builds scrape URLs with encoded target URLs", async () => {
    const buildPaidQueryEndpoint = await loadClient();

    expect(
      buildPaidQueryEndpoint({
        mode: "scrape",
        provider: "scrape.page",
        url: "https://developers.stellar.org/docs"
      })
    ).toBe(
      "http://localhost:3001/x402/scrape?provider=scrape.page&url=https%3A%2F%2Fdevelopers.stellar.org%2Fdocs"
    );
  });

  it("throws when required mode inputs are missing", async () => {
    const buildPaidQueryEndpoint = await loadClient();

    expect(() =>
      buildPaidQueryEndpoint({
        mode: "search",
        provider: "search.basic"
      })
    ).toThrow("query is required for search/news mode");

    expect(() =>
      buildPaidQueryEndpoint({
        mode: "scrape",
        provider: "scrape.page"
      })
    ).toThrow("url is required for scrape mode");
  });
});

describe("runPaidQuery error handling", () => {
  beforeEach(() => {
    process.env.API_BASE_URL = "http://localhost:3001";
    process.env.DEMO_MODE = "false";
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fails fast when real payment mode is enabled without a secret key", async () => {
    delete process.env.DEMO_CLIENT_SECRET_KEY;
    const { runPaidQuery } = await import("./client.js");

    await expect(
      runPaidQuery({
        mode: "search",
        provider: "search.basic",
        query: "stellar"
      })
    ).rejects.toThrow("DEMO_CLIENT_SECRET_KEY is required when DEMO_MODE is false");
  });

  it("reports unreachable API hosts with the configured base URL in demo mode", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:65535";
    process.env.DEMO_MODE = "true";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const { runPaidQuery } = await import("./client.js");

    await expect(
      runPaidQuery({
        mode: "search",
        provider: "search.basic",
        query: "stellar"
      })
    ).rejects.toThrow(
      "Unable to reach Query402 API at http://127.0.0.1:65535. Check API_BASE_URL and confirm the API server is running. Details: fetch failed"
    );
  });

  it("does not hide HTTP error responses from the API", async () => {
    process.env.DEMO_MODE = "true";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "payment required" }), {
          status: 402,
          headers: {
            "content-type": "application/json"
          }
        })
      )
    );
    const { runPaidQuery } = await import("./client.js");

    const result = await runPaidQuery({
      mode: "search",
      provider: "search.basic",
      query: "stellar"
    });

    expect(result).toMatchObject({
      status: 402,
      ok: false,
      body: { error: "payment required" }
    });
  });
});

describe("fetchWithQuoteBoundPayment redirect refusal", () => {
  const redirectCases: Array<{
    name: string;
    status: number;
    location: string | null;
  }> = [
    {
      name: "same-origin Location",
      status: 302,
      location: "http://localhost:3001/x402/search?provider=other"
    },
    {
      name: "cross-origin Location",
      status: 301,
      location: "https://evil.example/collect"
    },
    {
      name: "relative Location",
      status: 307,
      location: "/x402/search?provider=other"
    },
    {
      name: "missing Location",
      status: 303,
      location: null
    }
  ];

  for (const redirectCase of redirectCases) {
    it(`refuses ${redirectCase.name} without following or leaking secrets`, async () => {
      let calls = 0;
      const fetchStub = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        calls += 1;
        if (calls === 1) {
          return challengeResponse();
        }

        expect(init?.redirect).toBe("manual");
        const headers = new Headers(init?.headers);
        expect(headers.get("PAYMENT-SIGNATURE")).toBe(PAYMENT_HEADER_VALUE);

        const responseHeaders = new Headers();
        if (redirectCase.location !== null) {
          responseHeaders.set("Location", redirectCase.location);
        }
        return new Response(null, {
          status: redirectCase.status,
          headers: responseHeaders
        });
      });

      const client = new x402Client();

      try {
        await fetchWithQuoteBoundPayment(
          ENDPOINT,
          { method: "GET" },
          exactQuote,
          {
            fetch: fetchStub as unknown as typeof fetch,
            client,
            createPaymentHeaders: async () => ({
              "PAYMENT-SIGNATURE": PAYMENT_HEADER_VALUE
            })
          }
        );
        expect.unreachable("expected PaidRedirectError");
      } catch (error) {
        expect(error).toBeInstanceOf(PaidRedirectError);
        expect((error as PaidRedirectError).status).toBe(redirectCase.status);
        expect((error as PaidRedirectError).message).toMatch(/redirect/i);
        expect((error as PaidRedirectError).message).toContain(String(redirectCase.status));

        const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
        expect(serialized).not.toContain(PAYMENT_HEADER_VALUE);
        expect(serialized).not.toMatch(/PAYMENT-SIGNATURE/i);
        if (redirectCase.location) {
          expect(serialized).not.toContain(redirectCase.location);
          expect((error as PaidRedirectError).message).not.toContain(redirectCase.location);
        }
        expect(serialized).not.toMatch(/Location/i);
      }

      expect(fetchStub).toHaveBeenCalledTimes(2);
      const paidInit = fetchStub.mock.calls[1]?.[1] as RequestInit | undefined;
      expect(paidInit?.redirect).toBe("manual");
    });
  }

  it("sends payment-bearing retry with redirect manual and returns non-redirect responses", async () => {
    let calls = 0;
    const fetchStub = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        return challengeResponse();
      }
      expect(init?.redirect).toBe("manual");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json", "payment-response": "settled" }
      });
    });

    const client = new x402Client();
    const response = await fetchWithQuoteBoundPayment(
      ENDPOINT,
      { method: "GET" },
      exactQuote,
      {
        fetch: fetchStub as unknown as typeof fetch,
        client,
        createPaymentHeaders: async () => ({
          "PAYMENT-SIGNATURE": PAYMENT_HEADER_VALUE
        })
      }
    );

    expect(response.status).toBe(200);
    expect(fetchStub.mock.calls[1]?.[1]).toMatchObject({ redirect: "manual" });
  });
});
