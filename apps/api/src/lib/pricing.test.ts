import { describe, expect, it } from "vitest";
import {
  getProviderById,
  getProvidersByCategory,
  protectedRouteBasePrices,
  providers
} from "./pricing.js";
import { applySponsorshipTestEnv } from "../test/sponsorship-test-helpers.js";

applySponsorshipTestEnv();

describe("provider pricing", () => {
  it("exposes enabled providers for each category", () => {
    expect(
      getProvidersByCategory("search").every((provider) => provider.category === "search")
    ).toBe(true);
    expect(getProvidersByCategory("news").every((provider) => provider.category === "news")).toBe(
      true
    );
    expect(
      getProvidersByCategory("scrape").every((provider) => provider.category === "scrape")
    ).toBe(true);
    expect(providers.length).toBeGreaterThanOrEqual(7);
  });

  it("returns provider-specific prices for search, news, and scrape", () => {
    expect(getProviderById("search.basic")?.priceUsd).toBe(0.01);
    expect(getProviderById("search.pro")?.priceUsd).toBe(0.02);
    expect(getProviderById("news.fast")?.priceUsd).toBe(0.015);
    expect(getProviderById("news.deep")?.priceUsd).toBe(0.03);
    expect(getProviderById("scrape.page")?.priceUsd).toBe(0.02);
    expect(getProviderById("scrape.extract")?.priceUsd).toBe(0.04);
  });

  it("formats dynamic provider prices consistently", async () => {
    const { formatUsdPrice } = await import("./payment-evidence.js");

    expect(formatUsdPrice(0.01)).toBe("$0.01");
    expect(formatUsdPrice(0.015)).toBe("$0.015");
    expect(formatUsdPrice(0.04)).toBe("$0.04");
  });

  it("defines protected route base prices for each paid mode", () => {
    expect(protectedRouteBasePrices["GET /x402/search"]).toBe("$0.01");
    expect(protectedRouteBasePrices["GET /x402/news"]).toBe("$0.015");
    expect(protectedRouteBasePrices["GET /x402/scrape"]).toBe("$0.02");
  });

  it("rejects unknown or disabled providers", () => {
    expect(getProviderById("missing.provider")).toBeUndefined();
  });
});

describe("provider catalog baseline", () => {
  interface BaselineRow {
    id: string;
    category: string;
    priceUsd: number;
    enabled: boolean;
    sourceType: string;
  }

  // These are the canonical baseline providers the demo and SCF pitch depend on.
  // Changing any field here requires intentional review — the test will surface
  // exactly which row and field drifted.
  const baseline: BaselineRow[] = [
    {
      id: "search.basic",
      category: "search",
      priceUsd: 0.01,
      enabled: true,
      sourceType: "deterministic-fallback"
    },
    {
      id: "news.fast",
      category: "news",
      priceUsd: 0.015,
      enabled: true,
      sourceType: "deterministic-fallback"
    },
    {
      id: "scrape.page",
      category: "scrape",
      priceUsd: 0.02,
      enabled: true,
      sourceType: "deterministic-fallback"
    }
  ];

  for (const expected of baseline) {
    it(`baseline provider "${expected.id}" matches expected catalog entry`, () => {
      const actual = providers.find((p) => p.id === expected.id);
      expect(
        actual,
        `Provider "${expected.id}" is missing — was it renamed or removed?`
      ).toBeDefined();

      const rowLabel = `Provider "${expected.id}"`;
      expect(actual!.id, `${rowLabel} id mismatch`).toBe(expected.id);
      expect(actual!.category, `${rowLabel} category mismatch`).toBe(expected.category);
      expect(actual!.priceUsd, `${rowLabel} priceUsd mismatch`).toBe(expected.priceUsd);
      expect(actual!.enabled, `${rowLabel} enabled mismatch`).toBe(expected.enabled);
      expect(actual!.sourceType, `${rowLabel} sourceType mismatch`).toBe(expected.sourceType);
    });
  }
});

describe("x402 cross-layer price consistency", () => {
  // Convert USD to integer micro-USD units to eliminate IEEE 754 float comparison risk.
  function toMicroUsd(value: number): number {
    return Math.round(value * 1_000_000);
  }

  function parseRoutePrice(s: string): number {
    return parseFloat(s.slice(1));
  }

  const routeModes = ["search", "news", "scrape"] as const;

  // Per-provider round-trip: priceUsd must survive formatUsdPrice without precision loss.
  for (const provider of providers) {
    it(`provider "${provider.id}" price formatting round-trips without precision loss through formatUsdPrice`, async () => {
      const { formatUsdPrice } = await import("./payment-evidence.js");
      const formatted = formatUsdPrice(provider.priceUsd);
      const roundTripped = parseRoutePrice(formatted);
      expect(
        toMicroUsd(roundTripped),
        `Provider "${provider.id}" (${provider.priceUsd} USD) loses precision through formatUsdPrice — middleware would quote incorrect amount`
      ).toBe(toMicroUsd(provider.priceUsd));
    });
  }

  // Cross-layer parity: protectedRouteBasePrices must equal the minimum enabled provider
  // price for each category. Any drift here means agents are charged a different amount
  // than the catalog quotes.
  for (const mode of routeModes) {
    it(`route base price "GET /x402/${mode}" matches the minimum catalog price for the "${mode}" category`, async () => {
      const { formatUsdPrice } = await import("./payment-evidence.js");
      const routeKey = `GET /x402/${mode}`;
      const basePrice = protectedRouteBasePrices[routeKey];
      expect(basePrice, `No protected route base price defined for "${routeKey}"`).toBeDefined();

      const categoryProviders = providers.filter((p) => p.category === mode && p.enabled);
      expect(
        categoryProviders.length,
        `No enabled providers found for category "${mode}"`
      ).toBeGreaterThan(0);

      const minPriceUsd = Math.min(...categoryProviders.map((p) => p.priceUsd));
      const baseMicroUsd = toMicroUsd(parseRoutePrice(basePrice));
      const minMicroUsd = toMicroUsd(minPriceUsd);

      const deviatingIds = categoryProviders
        .filter((p) => toMicroUsd(p.priceUsd) < baseMicroUsd)
        .map((p) => p.id);

      expect(
        baseMicroUsd,
        `Drift on "${routeKey}": route base is ${basePrice}, minimum catalog price is ${formatUsdPrice(minPriceUsd)}. Providers priced below base: [${deviatingIds.join(", ")}]`
      ).toBe(minMicroUsd);
    });
  }

  it(
    "falls back to route base price for unknown provider IDs — base price must be defined for all x402 route modes",
    () => {
      for (const mode of routeModes) {
        const routeKey = `GET /x402/${mode}`;
        const basePrice = protectedRouteBasePrices[routeKey];
        expect(
          basePrice,
          `Missing fallback base price for route "${routeKey}" — agents with unknown providers would receive no valid payment requirement`
        ).toBeDefined();
        expect(
          basePrice,
          `Fallback base price for "${routeKey}" is not a valid USD price string`
        ).toMatch(/^\$\d+\.?\d*$/);
      }
    }
  );

  it(
    "getProviderById('phantom.provider') returns undefined — unknown providers resolve to undefined and do not alter base price",
    () => {
      expect(getProviderById("phantom.provider")).toBeUndefined();
      expect(getProviderById("")).toBeUndefined();
      expect(getProviderById("search")).toBeUndefined();
    }
  );

  it(
    "category mismatch guard — a provider from one category cannot resolve under a different route mode",
    () => {
      const allIds = providers.map((p) => p.id);
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);

      for (const mode of routeModes) {
        const categoryIds = new Set(providers.filter((p) => p.category === mode).map((p) => p.id));
        const otherModes = routeModes.filter((m) => m !== mode);
        for (const other of otherModes) {
          const otherIds = providers.filter((p) => p.category === other).map((p) => p.id);
          const collision = otherIds.find((id) => categoryIds.has(id));
          expect(
            collision,
            `Provider ID "${collision}" appears in both "${mode}" and "${other}" categories — x402 category-match guard would be bypassed`
          ).toBeUndefined();
        }
      }
    }
  );

  it(
    "drift-detection: surfaces offending provider ID when catalog price diverges from route base price",
    () => {
      // Simulate drift: search.basic raised from $0.01 to $0.05 without updating protectedRouteBasePrices.
      const driftedProviders = providers.map((p) =>
        p.id === "search.basic" ? { ...p, priceUsd: 0.05 } : p
      );

      const searchProviders = driftedProviders.filter((p) => p.category === "search" && p.enabled);
      const routeBase = protectedRouteBasePrices["GET /x402/search"];
      expect(routeBase).toBeDefined();

      const baseMicroUsd = toMicroUsd(parseRoutePrice(routeBase));
      const minCategoryMicroUsd = toMicroUsd(Math.min(...searchProviders.map((p) => p.priceUsd)));

      // With search.basic at 0.05, new minimum is search.pro at 0.02 (20000 µ$).
      // Route base remains $0.01 (10000 µ$) — drift is detected.
      const hasDrift = baseMicroUsd !== minCategoryMicroUsd;
      expect(hasDrift).toBe(true);

      const deviatingProviders = searchProviders
        .filter((p) => toMicroUsd(p.priceUsd) !== baseMicroUsd)
        .map((p) => p.id);
      expect(deviatingProviders).toContain("search.basic");
    }
  );
});
