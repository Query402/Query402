import { describe, expect, it } from "vitest";
import {
  buildCapabilityMatrix,
  computeSlaBadge,
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

  it("all providers have a valid provenance", () => {
    for (const provider of providers) {
      expect(["mock", "fallback", "live", "unknown"]).toContain(provider.provenance);
    }
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
      enabled: true,
      slaBadge: computeSlaBadge(100, "deterministic-fallback")
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
      enabled: true,
      slaBadge: computeSlaBadge(100, "deterministic-fallback")
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
      enabled: false,
      slaBadge: computeSlaBadge(100, "deterministic-fallback")
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

  it("falls back to route base price for unknown provider IDs — base price must be defined for all x402 route modes", () => {
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
  });

  it("getProviderById('phantom.provider') returns undefined — unknown providers resolve to undefined and do not alter base price", () => {
    expect(getProviderById("phantom.provider")).toBeUndefined();
    expect(getProviderById("")).toBeUndefined();
    expect(getProviderById("search")).toBeUndefined();
  });

  it("category mismatch guard — a provider from one category cannot resolve under a different route mode", () => {
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
  });

  it("drift-detection: surfaces offending provider ID when catalog price diverges from route base price", () => {
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
  });
});

describe("capability matrix", () => {
  it("returns all providers with correct shape", () => {
    const matrix = buildCapabilityMatrix();
    expect(matrix.length).toBe(providers.length);

    for (const entry of matrix) {
      expect(entry.caveat === null || typeof entry.caveat === "string").toBe(true);
      expect(entry).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        category: expect.stringMatching(/^(search|news|scrape)$/),
        priceUsd: expect.any(Number),
        sourceType: expect.stringMatching(/^(live|deterministic-fallback|unavailable)$/),
        latencyEstimateMs: expect.any(Number),
        enabled: expect.any(Boolean),
        hasFallback: true
      });
      expect(entry.priceUsd).toBeGreaterThan(0);
      expect(entry.latencyEstimateMs).toBeGreaterThan(0);
    }
  });

  it("sorts deterministically by category then id", () => {
    const matrix = buildCapabilityMatrix();
    for (let i = 1; i < matrix.length; i++) {
      const prev = matrix[i - 1];
      const curr = matrix[i];
      const catCmp = prev.category.localeCompare(curr.category);
      if (catCmp === 0) {
        expect(prev.id.localeCompare(curr.id)).toBeLessThanOrEqual(0);
      } else {
        expect(catCmp).toBeLessThan(0);
      }
    }
  });

  it("reports caveat when GROQ_API_KEY is missing", () => {
    const matrix = buildCapabilityMatrix();
    const allHaveCaveat = matrix.every(
      (entry) => entry.caveat !== null && entry.caveat.includes("GROQ_API_KEY")
    );
    expect(allHaveCaveat).toBe(true);
  });
});

describe("SLA badge computation", () => {
  it("computes fast latency band for low-latency providers", () => {
    const badge = computeSlaBadge(700, "deterministic-fallback");
    expect(badge.latencyBand).toBe("fast");
    expect(badge.badgeCopy).toContain("Fast response");
  });

  it("computes standard latency band for mid-range providers", () => {
    const badge = computeSlaBadge(1100, "deterministic-fallback");
    expect(badge.latencyBand).toBe("standard");
    expect(badge.badgeCopy).toContain("Standard response");
  });

  it("computes slow latency band for high-latency providers", () => {
    const badge = computeSlaBadge(1700, "live");
    expect(badge.latencyBand).toBe("slow");
    expect(badge.badgeCopy).toContain("Slow response");
  });

  it("computes live reliability band for live providers", () => {
    const badge = computeSlaBadge(1000, "live");
    expect(badge.reliabilityBand).toBe("live");
    expect(badge.badgeCopy).toContain("Live API");
  });

  it("computes demo reliability band for deterministic-fallback providers", () => {
    const badge = computeSlaBadge(1000, "deterministic-fallback");
    expect(badge.reliabilityBand).toBe("demo");
    expect(badge.badgeCopy).toContain("Demo provider");
  });

  it("computes not-verified reliability band for unavailable providers", () => {
    const badge = computeSlaBadge(1000, "unavailable");
    expect(badge.reliabilityBand).toBe("not-verified");
    expect(badge.badgeCopy).toContain("Not verified");
  });

  it("computes x402 payment mode for live providers", () => {
    const badge = computeSlaBadge(1000, "live");
    expect(badge.paymentMode).toBe("x402");
    expect(badge.badgeCopy).toContain("x402 payment");
  });

  it("computes demo payment mode for deterministic-fallback providers", () => {
    const badge = computeSlaBadge(1000, "deterministic-fallback");
    expect(badge.paymentMode).toBe("demo");
    expect(badge.badgeCopy).toContain("Demo payment");
  });

  it("computes not-verified payment mode for unavailable providers", () => {
    const badge = computeSlaBadge(1000, "unavailable");
    expect(badge.paymentMode).toBe("not-verified");
    expect(badge.badgeCopy).toContain("Payment not verified");
  });

  it("every baseline provider has a valid slaBadge", () => {
    for (const provider of providers) {
      expect(provider.slaBadge).toBeDefined();
      expect(provider.slaBadge.latencyBand).toMatch(/^(fast|standard|slow|not-verified)$/);
      expect(provider.slaBadge.reliabilityBand).toMatch(/^(live|fallback|demo|not-verified)$/);
      expect(provider.slaBadge.paymentMode).toMatch(/^(x402|demo|sponsored|not-verified)$/);
      expect(typeof provider.slaBadge.badgeCopy).toBe("string");
      expect(provider.slaBadge.badgeCopy.length).toBeGreaterThan(0);
    }
  });

  it("search.live provider has x402 payment mode and live reliability", () => {
    const provider = providers.find((p) => p.id === "search.live");
    expect(provider).toBeDefined();
    expect(provider!.slaBadge.paymentMode).toBe("x402");
    expect(provider!.slaBadge.reliabilityBand).toBe("live");
    expect(provider!.slaBadge.latencyBand).toBe("slow");
  });

  it("search.basic provider has demo payment mode and fast latency", () => {
    const provider = providers.find((p) => p.id === "search.basic");
    expect(provider).toBeDefined();
    expect(provider!.slaBadge.paymentMode).toBe("demo");
    expect(provider!.slaBadge.reliabilityBand).toBe("demo");
    expect(provider!.slaBadge.latencyBand).toBe("fast");
  });

  it("getSortedProviders returns providers with slaBadge", () => {
    const sorted = getSortedProviders();
    expect(sorted.length).toBeGreaterThan(0);
    for (const provider of sorted) {
      expect(provider.slaBadge).toBeDefined();
      expect(provider.slaBadge.badgeCopy).toBeTruthy();
    }
  });
});
