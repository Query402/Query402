import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
