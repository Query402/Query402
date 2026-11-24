import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { USDC_TESTNET_ADDRESS, convertToTokenAmount } from "@x402/stellar";
import { buildRequestedQuote } from "./quote-bind.js";

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

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports a positive bounded default timeout", async () => {
    const { AGENT_REQUEST_TIMEOUT_MS } = await import("./client.js");
    expect(AGENT_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(AGENT_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it("clears the timer and returns on success", async () => {
    const { fetchWithTimeout } = await import("./client.js");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const fetchFn = vi.fn(async () => new Response("ok", { status: 200 }));

    const response = await fetchWithTimeout("http://localhost:3001/health", undefined, {
      fetch: fetchFn as unknown as typeof fetch,
      timeoutMs: 5_000,
      phase: "request"
    });

    expect(response.status).toBe(200);
    expect(clearSpy).toHaveBeenCalled();
  });

  it("clears the timer and throws a stable timeout error on abort", async () => {
    const { fetchWithTimeout, RequestTimeoutError } = await import("./client.js");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const fetchFn = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        })
    );

    await expect(
      fetchWithTimeout("http://localhost:3001/api/providers", undefined, {
        fetch: fetchFn as unknown as typeof fetch,
        timeoutMs: 30,
        phase: "catalog"
      })
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(RequestTimeoutError);
      expect((error as Error).message).toBe("Request timed out after 30ms during catalog");
      expect(JSON.stringify(error)).not.toMatch(/SECRET|S[A-Z0-9]{55}|password|api[_-]?key/i);
      return true;
    });
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe("runPaidQuery bounded timeouts", () => {
  const NETWORK = "stellar:testnet";
  const ASSET = USDC_TESTNET_ADDRESS;
  const PROVIDER = "search.basic";
  const PRICE_USD = 0.01;
  const AMOUNT = convertToTokenAmount(PRICE_USD.toFixed(7));
  const quote = buildRequestedQuote({
    provider: PROVIDER,
    priceUsd: PRICE_USD,
    network: NETWORK,
    asset: ASSET
  });

  function hangingFetch(): typeof fetch {
    return vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        })
    ) as unknown as typeof fetch;
  }

  function challengeBody() {
    return {
      x402Version: 2,
      resource: {
        url: `http://localhost:3001/x402/search?provider=${PROVIDER}`,
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
    const paymentRequired = challengeBody();
    return new Response(JSON.stringify({ error: "Payment Required" }), {
      status: 402,
      headers: {
        "content-type": "application/json",
        "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired as never)
      }
    });
  }

  beforeEach(() => {
    process.env.API_BASE_URL = "http://localhost:3001";
    process.env.DEMO_MODE = "false";
    process.env.STELLAR_NETWORK = NETWORK;
    process.env.X402_ASSET = ASSET;
    // Challenge amounts use stellar token units; config parser treats them as
    // 6-decimal USD. Raise the ceiling so fixture quotes pass validation.
    process.env.X402_MAX_PRICE_USD = "1";
    process.env.DEMO_CLIENT_SECRET_KEY = "S".padEnd(56, "A");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("aborts a hung catalog lookup with a stable timeout error", async () => {
    const { runPaidQuery, RequestTimeoutError } = await import("./client.js");

    await expect(
      runPaidQuery(
        { mode: "search", provider: PROVIDER, query: "stellar" },
        { fetch: hangingFetch(), timeoutMs: 30 }
      )
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(RequestTimeoutError);
      expect((error as Error).message).toBe("Request timed out after 30ms during catalog");
      expect(JSON.stringify(error)).not.toMatch(/SECRET|S[A-Z0-9]{55}/i);
      return true;
    });
  });

  it("aborts a hung challenge probe and never signs", async () => {
    const sign = vi.fn();
    const { runPaidQuery, RequestTimeoutError } = await import("./client.js");

    await expect(
      runPaidQuery(
        { mode: "search", provider: PROVIDER, query: "stellar" },
        {
          fetch: hangingFetch(),
          quote,
          timeoutMs: 30,
          createPaymentHeaders: async () => {
            sign();
            return { "PAYMENT-SIGNATURE": "should-not-sign" };
          }
        }
      )
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(RequestTimeoutError);
      expect((error as Error).message).toBe("Request timed out after 30ms during challenge");
      return true;
    });

    expect(sign).not.toHaveBeenCalled();
  });

  it("aborts a hung paid retry after a successful challenge", async () => {
    const sign = vi.fn().mockResolvedValue(undefined);
    let challengeCalls = 0;
    const fetchStub = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const hasPayment = Boolean(
        init?.headers &&
          new Headers(init.headers as HeadersInit).get("PAYMENT-SIGNATURE")
      );
      if (!hasPayment) {
        challengeCalls += 1;
        return challengeResponse();
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }) as unknown as typeof fetch;

    const { runPaidQuery, RequestTimeoutError } = await import("./client.js");

    await expect(
      runPaidQuery(
        { mode: "search", provider: PROVIDER, query: "stellar" },
        {
          fetch: fetchStub,
          quote,
          timeoutMs: 40,
          createWallet: () => ({
            address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
            signAuthEntry: async () => {
              throw new Error("wallet should not sign when createPaymentHeaders is stubbed");
            }
          }),
          createPaymentHeaders: async () => {
            await sign();
            return { "PAYMENT-SIGNATURE": "signed-fixture" };
          }
        }
      )
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(RequestTimeoutError);
      expect((error as Error).message).toBe("Request timed out after 40ms during paid-retry");
      return true;
    });

    expect(sign).toHaveBeenCalledTimes(1);
    expect(challengeCalls).toBeGreaterThanOrEqual(1);
  });
});
