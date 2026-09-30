import type {
  LatencyBand,
  PaymentModeBand,
  ProviderCapability,
  ProviderDefinition,
  ProviderSlaBadge,
  ReliabilityBand,
  SlaBadges,
  SourceType
} from "@query402/shared";

export class ProviderCatalogConflictError extends Error {
  readonly code = "provider_catalog_conflict" as const;
  readonly providerIds: string[];

  constructor(providerIds: string[]) {
    const ids = [...providerIds].sort();
    super(`Provider catalog contains duplicate provider id(s): ${ids.join(", ")}`);
    this.name = "ProviderCatalogConflictError";
    this.providerIds = ids;
  }
}

export class PriceMismatchError extends Error {
  readonly code = "price_mismatch" as const;
  constructor(readonly challengeUnits: number, readonly catalogUnits: number) {
    super(`x402 challenge amount (${challengeUnits}) does not match catalog price (${catalogUnits})`);
    this.name = "PriceMismatchError";
  }
}

export class ZeroPriceError extends Error {
  readonly code = "zero_price" as const;
  constructor(readonly providerId: string) {
    super(`Provider "${providerId}" has a zero price; refusing to build an x402 challenge`);
    this.name = "ZeroPriceError";
  }
}

export class UnsafePriceError extends Error {
  readonly code = "unsafe_price" as const;
  constructor(readonly value: number) {
    super(`Price ${value} is outside the safe integer range`);
    this.name = "UnsafePriceError";
  }
}

export const USD_UNITS_PER_DOLLAR = 1_000_000;

export function assertSafePriceUnits(units: number): number {
  if (!Number.isSafeInteger(units)) {
    throw new UnsafePriceError(units);
  }
  return units;
}

export function usdStringToUnits(price: string): number {
  const trimmed = price.trim();
  const match = /^\$?(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new UnsafePriceError(Number.NaN);
  }
  const whole = match[1];
  const frac = match[2] ?? "";
  const fracPadded = (frac + "000000").slice(0, 6);
  const units = Number(whole) * USD_UNITS_PER_DOLLAR + Number(fracPadded);
  if (!Number.isSafeInteger(units)) {
    throw new UnsafePriceError(units);
  }
  return units;
}

export function unitsToUsdString(units: number): string {
  if (!Number.isSafeInteger(units)) {
    throw new UnsafePriceError(units);
  }
  const whole = Math.trunc(units / USD_UNITS_PER_DOLLAR);
  const frac = units % USD_UNITS_PER_DOLLAR;
  if (frac === 0) {
    return `$${whole}`;
  }
  const fracStr = String(frac).padStart(6, "0").replace(/0+$/, "");
  return `$${whole}.${fracStr}`;
}

export function priceUsdToUnits(priceUsd: number): number {
  if (!Number.isFinite(priceUsd)) {
    throw new UnsafePriceError(priceUsd);
  }
  const units = Math.round(priceUsd * USD_UNITS_PER_DOLLAR);
  if (!Number.isSafeInteger(units)) {
    throw new UnsafePriceError(units);
  }
  return units;
}

export function getProviderPriceUnits(providerId: string): number {
  const provider = getProviderById(providerId);
  if (!provider) {
    throw new Error(`Provider not found or disabled: ${providerId}`);
  }
  return priceUsdToUnits(provider.priceUsd);
}

export function assertPriceMatch(challengeUnits: number, catalogUnits: number): void {
  if (challengeUnits !== catalogUnits) {
    throw new PriceMismatchError(challengeUnits, catalogUnits);
  }
}

export function buildChallengeAmountUnits(providerId: string): number {
  const catalogUnits = getProviderPriceUnits(providerId);
  if (catalogUnits === 0) {
    throw new ZeroPriceError(providerId);
  }
  assertSafePriceUnits(catalogUnits);
  const challengeUnits = catalogUnits;
  assertPriceMatch(challengeUnits, catalogUnits);
  return challengeUnits;
}

const envKeyMapping: Record<string, string[]> = {
  "search.live": ["GROQ_API_KEY"],
  "search.basic": ["GROQ_API_KEY"],
  "search.pro": ["GROQ_API_KEY"],
  "news.fast": ["GROQ_API_KEY"],
  "news.deep": ["GROQ_API_KEY"],
  "scrape.page": ["GROQ_API_KEY"],
  "scrape.extract": ["GROQ_API_KEY"]
};

function computeCaveat(providerId: string): string | null {
  const required = envKeyMapping[providerId];
  if (!required) return null;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length === 0) return null;
  return `${missing.join(", ")} not configured — falling back to deterministic results`;
}

function computeLatencyBand(latencyMs: number): LatencyBand {
  if (latencyMs < 800) return "fast";
  if (latencyMs < 1500) return "standard";
  return "slow";
}

function computeReliabilityBand(sourceType: SourceType): ReliabilityBand {
  switch (sourceType) {
    case "live":
      return "live";
    case "deterministic-fallback":
      return "demo";
    case "unavailable":
      return "not-verified";
    default:
      return "not-verified";
  }
}

function computePaymentMode(sourceType: SourceType): PaymentModeBand {
  switch (sourceType) {
    case "live":
      return "x402";
    case "deterministic-fallback":
      return "demo";
    case "unavailable":
      return "not-verified";
    default:
      return "not-verified";
  }
}

export function computeSlaBadge(
  latencyEstimateMs: number,
  sourceType: SourceType
): ProviderSlaBadge {
  const latencyBand = computeLatencyBand(latencyEstimateMs);
  const reliabilityBand = computeReliabilityBand(sourceType);
  const paymentMode = computePaymentMode(sourceType);

  const latencyLabel =
    latencyBand === "fast"
      ? "Fast"
      : latencyBand === "standard"
        ? "Standard"
        : latencyBand === "slow"
          ? "Slow"
          : "Unknown latency";

  const reliabilityLabel =
    reliabilityBand === "live"
      ? "Live API"
      : reliabilityBand === "demo"
        ? "Demo provider"
        : reliabilityBand === "fallback"
          ? "Fallback provider"
          : "Not verified";

  const paymentLabel =
    paymentMode === "x402"
      ? "x402 payment"
      : paymentMode === "demo"
        ? "Demo payment"
        : paymentMode === "sponsored"
          ? "Sponsored"
          : "Payment not verified";

  const badgeCopy = `${latencyLabel} response · ${reliabilityLabel} · ${paymentLabel}`;

  return { latencyBand, reliabilityBand, paymentMode, badgeCopy };
}

/**
 * Dashboard-facing SLA badge summary. Deliberately distinct from the canonical
 * per-provider slaBadge: latency thresholds here come from the original
 * catalog-badge feature (<=800ms fast, <=1500ms standard), deterministic
 * fallback providers are reported as "fallback", and payment mode is always
 * x402 because every catalog provider settles through the x402 flow.
 */
export function deriveSlaBadges(providerData: {
  sourceType: ProviderDefinition["sourceType"];
  latencyEstimateMs: number;
}): SlaBadges {
  const latencyBand =
    providerData.latencyEstimateMs <= 800
      ? "fast"
      : providerData.latencyEstimateMs <= 1500
        ? "standard"
        : "slow";

  const latencyLabels: Record<string, string> = {
    fast: "Fast response",
    standard: "Standard latency",
    slow: "Higher latency"
  };

  const reliabilityBand =
    providerData.sourceType === "live"
      ? "live"
      : providerData.sourceType === "deterministic-fallback"
        ? "fallback"
        : "demo";

  const reliabilityLabels: Record<string, string> = {
    live: "Live results",
    fallback: "Fallback cached",
    demo: "Demo reliability"
  };

  return {
    latencyBand,
    latencyLabel: latencyLabels[latencyBand],
    reliabilityBand,
    reliabilityLabel: reliabilityLabels[reliabilityBand],
    paymentMode: "x402",
    paymentLabel: "Pay-per-query (x402)"
  };
}

export function buildCapabilityMatrix(): ProviderCapability[] {
  return providers
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      priceUsd: p.priceUsd,
      sourceType: p.sourceType,
      latencyEstimateMs: p.latencyEstimateMs,
      enabled: p.enabled,
      hasFallback: true,
      caveat: computeCaveat(p.id)
    }))
    .sort((a, b) => {
      const cat = a.category.localeCompare(b.category);
      return cat !== 0 ? cat : a.id.localeCompare(b.id);
    });
}

export const providers: ProviderDefinition[] = [
  {
    id: "search.live",
    name: "Live Web Search",
    category: "search",
    priceUsd: 0.05,
    description: "Live real-time search with actual web data.",
    latencyEstimateMs: 1500,
    qualityScore: 99,
    sourceType: "live",
    provenance: "live",
    enabled: true,
    slaBadge: computeSlaBadge(1500, "live"),
    slaBadges: deriveSlaBadges({ sourceType: "live", latencyEstimateMs: 1500 })
  },
  {
    id: "search.basic",
    name: "Basic Search",
    category: "search",
    priceUsd: 0.01,
    description: "Fast, broad web signal retrieval for general prompts.",
    latencyEstimateMs: 700,
    qualityScore: 75,
    sourceType: "deterministic-fallback",
    provenance: "mock",
    enabled: true,
    slaBadge: computeSlaBadge(700, "deterministic-fallback"),
    slaBadges: deriveSlaBadges({ sourceType: "deterministic-fallback", latencyEstimateMs: 700 })
  },
  {
    id: "search.pro",
    name: "Pro Search",
    category: "search",
    priceUsd: 0.02,
    description: "Higher quality ranking with richer snippets.",
    latencyEstimateMs: 1100,
    qualityScore: 90,
    sourceType: "deterministic-fallback",
    provenance: "mock",
    enabled: true,
    slaBadge: computeSlaBadge(1100, "deterministic-fallback"),
    slaBadges: deriveSlaBadges({ sourceType: "deterministic-fallback", latencyEstimateMs: 1100 })
  },
  {
    id: "news.fast",
    name: "Fast News",
    category: "news",
    priceUsd: 0.015,
    description: "Latest headlines with low latency.",
    latencyEstimateMs: 800,
    qualityScore: 72,
    sourceType: "deterministic-fallback",
    provenance: "mock",
    enabled: true,
    slaBadge: computeSlaBadge(800, "deterministic-fallback"),
    slaBadges: deriveSlaBadges({ sourceType: "deterministic-fallback", latencyEstimateMs: 800 })
  },
  {
    id: "news.deep",
    name: "Deep News",
    category: "news",
    priceUsd: 0.03,
    description: "Clustered and contextualized stories.",
    latencyEstimateMs: 1400,
    qualityScore: 93,
    sourceType: "deterministic-fallback",
    provenance: "mock",
    enabled: true,
    slaBadge: computeSlaBadge(1400, "deterministic-fallback"),
    slaBadges: deriveSlaBadges({ sourceType: "deterministic-fallback", latencyEstimateMs: 1400 })
  },
  {
    id: "scrape.page",
    name: "Page Scrape",
    category: "scrape",
    priceUsd: 0.02,
    description: "Raw page extraction with quick metadata.",
    latencyEstimateMs: 1000,
    qualityScore: 70,
    sourceType: "deterministic-fallback",
    provenance: "mock",
    enabled: true,
    slaBadge: computeSlaBadge(1000, "deterministic-fallback"),
    slaBadges: deriveSlaBadges({ sourceType: "deterministic-fallback", latencyEstimateMs: 1000 })
  },
  {
    id: "scrape.extract",
    name: "Structured Extract",
    category: "scrape",
    priceUsd: 0.04,
    description: "Structured entities and concise extraction.",
    latencyEstimateMs: 1700,
    qualityScore: 95,
    sourceType: "deterministic-fallback",
    provenance: "mock",
    enabled: true,
    slaBadge: computeSlaBadge(1700, "deterministic-fallback"),
    slaBadges: deriveSlaBadges({ sourceType: "deterministic-fallback", latencyEstimateMs: 1700 })
  }
];

/**
 * Validate catalog identity before any catalog projection is published. IDs
 * are the routing key, so silently selecting the first duplicate would make
 * pricing and execution depend on array order.
 */
export function validateProviderCatalog(
  catalog: readonly Pick<ProviderDefinition, "id">[] = providers
): void {
  const counts = new Map<string, number>();
  for (const provider of catalog) {
    counts.set(provider.id, (counts.get(provider.id) ?? 0) + 1);
  }

  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
  if (duplicates.length > 0) {
    throw new ProviderCatalogConflictError(duplicates);
  }
}

export const protectedRouteBasePrices: Record<string, string> = {
  "GET /x402/search": "$0.01",
  "GET /x402/news": "$0.015",
  "GET /x402/scrape": "$0.02"
};

export function getProviderById(providerId: string) {
  validateProviderCatalog();
  return providers.find((provider) => provider.id === providerId && provider.enabled);
}

export function getProvidersByCategory(category: ProviderDefinition["category"]) {
  validateProviderCatalog();
  return providers.filter((provider) => provider.category === category && provider.enabled);
}

export function getSortedProviders(): ProviderDefinition[] {
  validateProviderCatalog();
  return [...providers]
    .filter((provider) => provider.enabled)
    .sort((a, b) => {
      const categoryCompare = a.category.localeCompare(b.category);
      if (categoryCompare !== 0) return categoryCompare;

      const priceCompare = a.priceUsd - b.priceUsd;
      if (priceCompare !== 0) return priceCompare;

      return a.id.localeCompare(b.id);
    });
}
