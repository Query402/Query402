import { describe, expect, it } from "vitest";
import {
  getProviderById,
  getProvidersByCategory,
  getSortedProviders,
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
      enabled: true
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
      enabled: true
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
      enabled: false
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
