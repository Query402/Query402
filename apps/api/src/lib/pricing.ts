import type { ProviderCapability, ProviderDefinition } from "@query402/shared";

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
    enabled: true
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
    enabled: true
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
    enabled: true
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
    enabled: true
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
    enabled: true
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
    enabled: true
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
    enabled: true
  }
];

export const protectedRouteBasePrices: Record<string, string> = {
  "GET /x402/search": "$0.01",
  "GET /x402/news": "$0.015",
  "GET /x402/scrape": "$0.02"
};

export function getProviderById(providerId: string) {
  return providers.find((provider) => provider.id === providerId && provider.enabled);
}

export function getProvidersByCategory(category: ProviderDefinition["category"]) {
  return providers.filter((provider) => provider.category === category && provider.enabled);
}

export function getSortedProviders(): ProviderDefinition[] {
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
