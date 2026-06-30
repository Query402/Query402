import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HTTPRequestContext } from "@x402/core/server";
import { applyApiTestEnv, resetApiTestStorage, TEST_WALLET } from "../test/api-test-helpers.js";
import { getProviderById, protectedRouteBasePrices } from "../lib/pricing.js";

const STELLAR_TESTNET = "stellar:testnet";
const DEFAULT_FACILITATOR = "https://channels.openzeppelin.com/x402/testnet";

type RouteMode = "search" | "news" | "scrape";

interface ProviderPriceCase {
  id: string;
  price: string;
}

interface RouteCase {
  mode: RouteMode;
  route: string;
  basePrice: string;
  validQuery: Record<string, string>;
  providers: ProviderPriceCase[];
}

const routeCases: RouteCase[] = [
  {
    mode: "search",
    route: "/x402/search",
    basePrice: "$0.01",
    validQuery: { provider: "search.basic", q: "stellar x402" },
    providers: [
      { id: "search.basic", price: "$0.01" },
      { id: "search.pro", price: "$0.02" },
      { id: "search.live", price: "$0.05" }
    ]
  },
  {
    mode: "news",
    route: "/x402/news",
    basePrice: "$0.015",
    validQuery: { provider: "news.fast", q: "stellar news" },
    providers: [
      { id: "news.fast", price: "$0.015" },
      { id: "news.deep", price: "$0.03" }
    ]
  },
  {
    mode: "scrape",
    route: "/x402/scrape",
    basePrice: "$0.02",
    validQuery: { provider: "scrape.page", url: "https://example.com/article" },
    providers: [
      { id: "scrape.page", price: "$0.02" },
      { id: "scrape.extract", price: "$0.04" }
    ]
  }
];

function makeContext(provider: string | undefined): HTTPRequestContext {
  const queryParams: Record<string, string> = provider ? { provider } : {};
  return {
    adapter: {
      getQueryParam: (key: string) => (key === "provider" ? provider : undefined),
      getQueryParams: () => queryParams
    }
  } as unknown as HTTPRequestContext;
}

describe("x402 payment requirement snapshot", () => {
  let analyticsDbPath: string;
  let sponsorshipDbPath: string;

  beforeEach(() => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv());
  });

  afterEach(async () => {
    await resetApiTestStorage(analyticsDbPath, sponsorshipDbPath);
    vi.restoreAllMocks();
  });

  async function createApp() {
    const { createX402Middleware } = await import("../lib/x402.js");
    const { protectedRouter } = await import("../routes/protected.js");
    const app = express();
    app.use(createX402Middleware());
    app.use(protectedRouter);
    return app;
  }

  describe("HTTP 402 payment requirement shape per protected route", () => {
    for (const routeCase of routeCases) {
      describe(`GET ${routeCase.route}`, () => {
        it(`returns 402 with base price ${routeCase.basePrice} and stable x402 fields`, async () => {
          const app = await createApp();
          const response = await request(app).get(routeCase.route).query(routeCase.validQuery);

          expect(response.status, `route=${routeCase.route} status drifted`).toBe(402);
          expect(response.body, `route=${routeCase.route} body shape drifted`).toMatchObject({
            error: "Payment Required",
            demoMode: true,
            accepts: {
              scheme: "exact",
              network: STELLAR_TESTNET,
              price: routeCase.basePrice,
              payTo: TEST_WALLET,
              facilitator: DEFAULT_FACILITATOR
            }
          });
          expect(typeof response.body.instructions, `route=${routeCase.route}`).toBe("string");
        });

        it(`base price for GET ${routeCase.route} matches protectedRouteBasePrices snapshot`, () => {
          const key = `GET ${routeCase.route}`;
          expect(
            protectedRouteBasePrices[key],
            `protectedRouteBasePrices[${key}] drifted from snapshot`
          ).toBe(routeCase.basePrice);
        });
      });
    }
  });

  describe("provider-aware price resolution (resolveRoutePrice)", () => {
    it("is exported as a pure price resolver", async () => {
      const { resolveRoutePrice } = await import("../lib/x402.js");
      expect(typeof resolveRoutePrice).toBe("function");
    });

    for (const routeCase of routeCases) {
      describe(`GET ${routeCase.route}`, () => {
        it("falls back to base price when no provider is supplied", async () => {
          const { resolveRoutePrice } = await import("../lib/x402.js");
          const price = resolveRoutePrice(makeContext(undefined), routeCase.mode);
          expect(price, `route=${routeCase.route} no-provider drift`).toBe(routeCase.basePrice);
        });

        it("falls back to base price when provider does not match the route mode", async () => {
          const { resolveRoutePrice } = await import("../lib/x402.js");
          const mismatchedProvider = routeCase.mode === "search" ? "news.fast" : "search.basic";
          const price = resolveRoutePrice(makeContext(mismatchedProvider), routeCase.mode);
          expect(
            price,
            `route=${routeCase.route} mismatched provider=${mismatchedProvider} drift`
          ).toBe(routeCase.basePrice);
        });

        it("falls back to base price when provider is unknown", async () => {
          const { resolveRoutePrice } = await import("../lib/x402.js");
          const price = resolveRoutePrice(makeContext("missing.provider"), routeCase.mode);
          expect(price, `route=${routeCase.route} unknown provider drift`).toBe(
            routeCase.basePrice
          );
        });

        for (const providerCase of routeCase.providers) {
          it(`resolves provider ${providerCase.id} to ${providerCase.price}`, async () => {
            const { resolveRoutePrice } = await import("../lib/x402.js");
            const price = resolveRoutePrice(makeContext(providerCase.id), routeCase.mode);
            expect(price, `route=${routeCase.route} provider=${providerCase.id} price drift`).toBe(
              providerCase.price
            );
          });
        }
      });
    }
  });

  describe("provider catalog price snapshot", () => {
    const expectedPrices: Record<string, number> = {
      "search.basic": 0.01,
      "search.pro": 0.02,
      "search.live": 0.05,
      "news.fast": 0.015,
      "news.deep": 0.03,
      "scrape.page": 0.02,
      "scrape.extract": 0.04
    };

    for (const [providerId, expectedPrice] of Object.entries(expectedPrices)) {
      it(`provider ${providerId} priceUsd is ${expectedPrice}`, () => {
        const provider = getProviderById(providerId);
        expect(provider, `provider=${providerId} missing from catalog`).toBeDefined();
        expect(provider?.priceUsd, `provider=${providerId} priceUsd drifted from snapshot`).toBe(
          expectedPrice
        );
      });
    }
  });
});
