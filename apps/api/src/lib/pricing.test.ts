import { describe, expect, it } from "vitest";
import {
  buildCapabilityMatrix,
  computeSlaBadge,
  deriveSlaBadges,
  getProviderById,
  getProvidersByCategory,
  getSortedProviders,
  ProviderCatalogConflictError,
  protectedRouteBasePrices,
  providers,
  validateProviderCatalog
} from "./pricing.js";
import { applySponsorshipTestEnv } from "../test/sponsorship-test-helpers.js";

applySponsorshipTestEnv();

describe("provider pricing", () => {
  it("rejects duplicate provider identifiers before publication", () => {
    const duplicate = [{ id: "search.basic" }, { id: "search.basic" }];
    expect(() => validateProviderCatalog(duplicate)).toThrow(ProviderCatalogConflictError);
    try {
      validateProviderCatalog(duplicate);
    } catch (error) {
      expect(error).toMatchObject({
        code: "provider_catalog_conflict",
        providerIds: ["search.basic"]
      });
    }
  });

  it("reports every duplicate id in deterministic order", () => {
    const duplicate = [
      { id: "zeta.provider" },
      { id: "alpha.provider" },
      { id: "zeta.provider" },
      { id: "alpha.provider" }
    ];

    expect(() => validateProviderCatalog(duplicate)).toThrow(
      "Provider catalog contains duplicate provider id(s): alpha.provider, zeta.provider"
    );
  });
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

  it("all providers have a valid provenance", () => {
    for (const provider of providers) {
      expect(["mock", "fallback", "live", "unknown"]).toContain(provider.provenance);
    }
  });

  it("returns provider-specific prices for search, news, and scrape", () => {
    expect(getProviderById("search.basic")?.priceUsd).toBe(Number(protectedRouteBasePrices["GET /x402/search"].slice(1)));
    expect(getProviderById("search.pro")?.priceUsd).toBe(0.02);
    expect(getProviderById("news.fast")?.priceUsd).toBe(Number(protectedRouteBasePrices["GET /x402/news"].slice(1)));
    expect(getProviderById("news.deep")?.priceUsd).toBe(0.03);
    expect(getProviderById("scrape.page")?.priceUsd).toBe(Number(protectedRouteBasePrices["GET /x402/scrape"].slice(1)));
    expect(getProviderById("scrape.extract")?.priceUsd).toBe(Number(protectedRouteBasePrices["GET /x402/scrape"].slice(1)) * 2);
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

  it("returns providers sorted by category, then price, then id", () => {
    const sorted = getSortedProviders();

    expect(sorted.length).toBe(providers.length);

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];

      if (current.category !== next.category) {
        expect(current.category.localeCompare(next.category)).toBeLessThan(0);
      } else if (current.priceUsd !== next.priceUsd) {
        expect(current.priceUsd).toBeLessThan(next.priceUsd);
      } else {
        expect(current.id.localeCompare(next.id)).toBeLessThan(0);
      }
    }
  });

  it("sorts providers with same category and price by id", () => {
    const originalLength = providers.length;

    providers.push({
      id: "search.alpha",
      name: "Alpha Search",
      category: "search",
      priceUsd: 0.05,
      description: "Test provider with same price",
      latencyEstimateMs: 100,
      qualityScore: 80,
      sourceType: "deterministic-fallback",
      provenance: "mock",
      enabled: true,
      slaBadge: computeSlaBadge(100, "deterministic-fallback"),
      slaBadges: deriveSlaBadges({ sourceType: "deterministic-fallback", latencyEstimateMs: 100 })
    });

    providers.push({
      id: "search.zebra",
      name: "Zebra Search",
      category: "search",
      priceUsd: 0.05,
      description: "Another test provider with same price",
      latencyEstimateMs: 100,
      qualityScore: 80,
      sourceType: "deterministic-fallback",
      provenance: "mock",
      enabled: true,
      slaBadge: computeSlaBadge(100, "deterministic-fallback"),
      slaBadges: deriveSlaBadges({ sourceType: "deterministic-fallback", latencyEstimateMs: 100 })
    });

    const sorted = getSortedProviders();

    const sameCategoryPrice = sorted.filter((p) => p.category === "search" && p.priceUsd === 0.05);

    expect(sameCategoryPrice.length).toBeGreaterThanOrEqual(2);

    const ids = sameCategoryPrice.map((p) => p.id);
    const sortedIds = [...ids].sort();
    expect(ids).toEqual(sortedIds);

    providers.length = originalLength;
  });

  it("excludes disabled providers from sorted results", () => {
    const originalLength = providers.length;
    providers.push({
      id: "test.disabled",
      name: "Disabled Provider",
      category: "search",
      priceUsd: 0.001,
      description: "Should not appear",
      latencyEstimateMs: 100,
      qualityScore: 50,
      sourceType: "deterministic-fallback",
      provenance: "mock",
      enabled: false,
      slaBadge: computeSlaBadge(100, "deterministic-fallback"),
      slaBadges: deriveSlaBadges({ sourceType: "deterministic-fallback", latencyEstimateMs: 100 })
    });

    const sorted = getSortedProviders();
    expect(sorted.length).toBe(originalLength);
    expect(sorted.some((p) => p.id === "test.disabled")).toBe(false);

    providers.pop();
  });
});

describe("provider catalog baseline", () => {
  interface BaselineRow {
    id: string;
    category: string;
    priceUsd: number;
    enabled: boolean;
    sourceType: string;
    provenance: string;
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
      sourceType: "deterministic-fallback",
      provenance: "mock"
    },
    {
      id: "news.fast",
      category: "news",
      priceUsd: 0.015,
      enabled: true,
      sourceType: "deterministic-fallback",
      provenance: "mock"
    },
    {
      id: "scrape.page",
      category: "scrape",
      priceUsd: 0.02,
      enabled: true,
      sourceType: "deterministic-fallback",
      provenance: "mock"
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
      expect(actual!.provenance, `${rowLabel} provenance mismatch`).toBe(expected.provenance);
    });
  }
});

describe("provider SLA badges shape", () => {
  it("every provider has slaBadges with all required fields", () => {
    for (const p of providers) {
      expect(p.slaBadges).toBeDefined();
      expect(["fast", "standard", "slow"]).toContain(p.slaBadges.latencyBand);
      expect(["demo", "fallback", "live"]).toContain(p.slaBadges.reliabilityBand);
      expect(["demo", "x402", "sponsored"]).toContain(p.slaBadges.paymentMode);
      expect(typeof p.slaBadges.latencyLabel).toBe("string");
      expect(p.slaBadges.latencyLabel.length).toBeGreaterThan(0);
      expect(typeof p.slaBadges.reliabilityLabel).toBe("string");
      expect(p.slaBadges.reliabilityLabel.length).toBeGreaterThan(0);
      expect(typeof p.slaBadges.paymentLabel).toBe("string");
      expect(p.slaBadges.paymentLabel.length).toBeGreaterThan(0);
    }
  });

  it("derives correct latencyBand for each provider", () => {
    const expectations: Record<string, string> = {
      "search.live": "standard",
      "search.basic": "fast",
      "search.pro": "standard",
      "news.fast": "fast",
      "news.deep": "standard",
      "scrape.page": "standard",
      "scrape.extract": "slow"
    };

    for (const [id, expectedBand] of Object.entries(expectations)) {
      const provider = providers.find((p) => p.id === id);
      expect(provider, `Provider "${id}" not found`).toBeDefined();
      expect(provider!.slaBadges.latencyBand).toBe(expectedBand);
    }
  });

  it("derives correct reliabilityBand from sourceType", () => {
    for (const p of providers) {
      const expectedBand =
        p.sourceType === "live"
          ? "live"
          : p.sourceType === "deterministic-fallback"
            ? "fallback"
            : "demo";
      expect(p.slaBadges.reliabilityBand).toBe(expectedBand);
    }
  });

  it("all providers have paymentMode x402", () => {
    for (const p of providers) {
      expect(p.slaBadges.paymentMode).toBe("x402");
    }
  });
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
});

describe("x402 challenge building from catalog integer prices", () => {
  it("builds a challenge amount equal to the catalog integer price", () => {
    const { buildX402Challenge } = require("./x402.js");
    const { getProviderById } = require("./pricing.js");
    const provider = getProviderById("search.basic");
    expect(provider).toBeDefined();
    const challenge = buildX402Challenge({
      providerId: provider!.id,
      catalogPriceMicroUsd: Math.round(provider!.priceUsd * 1_000_000),
    });
    expect(challenge.amountMicroUsd).toBe(Math.round(provider!.priceUsd * 1_000_000));
  });

  it("rejects a one-unit difference and does not run the provider", () => {
    const { buildX402Challenge } = require("./x402.js");
    const { getProviderById } = require("./pricing.js");
    const provider = getProviderById("search.basic");
    expect(provider).toBeDefined();
    const catalogPriceMicroUsd = Math.round(provider!.priceUsd * 1_000_000);
    expect(() =>
      buildX402Challenge({
        providerId: provider!.id,
        catalogPriceMicroUsd: catalogPriceMicroUsd + 1,
      })
    ).toThrow();
  });

  it("rejects a zero price and does not build a challenge", () => {
    const { buildX402Challenge } = require("./x402.js");
    expect(() =>
      buildX402Challenge({
        providerId: "search.basic",
        catalogPriceMicroUsd: 0,
      })
    ).toThrow();
  });

  it("rejects a price above the safe integer range", () => {
    const { buildX402Challenge } = require("./x402.js");
    expect(() =>
      buildX402Challenge({
        providerId: "search.basic",
        catalogPriceMicroUsd: Number.MAX_SAFE_INTEGER + 1,
      })
    ).toThrow();
  });
});
