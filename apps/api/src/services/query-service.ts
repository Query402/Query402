import { getProviderById, providers } from "../lib/pricing.js";
import { runSearchProvider } from "../providers/search.js";
import { runNewsProvider } from "../providers/news.js";
import { runScrapeProvider } from "../providers/scrape.js";
import { validateScrapeUrl } from "../lib/scrape-url-safety.js";

export async function executeQuery(params: {
  mode: "search" | "news" | "scrape";
  provider: string;
  q?: string;
  url?: string;
}) {
  const provider = getProviderById(params.provider);
  if (!provider) {
    throw new Error(`Provider not found or disabled: ${params.provider}`);
  }

  if (provider.category !== params.mode) {
    throw new Error(`Provider ${provider.id} does not support mode ${params.mode}`);
  }

  if (params.mode === "search") {
    if (!params.q) {
      throw new Error("q is required for search mode");
    }
    return runSearchProvider(params.q, params.provider);
  }

  if (params.mode === "news") {
    if (!params.q) {
      throw new Error("q is required for news mode");
    }
    return runNewsProvider(params.q, params.provider);
  }

  if (!params.url) {
    throw new Error("url is required for scrape mode");
  }

  const safeUrl = await validateScrapeUrl(params.url);
  return runScrapeProvider(safeUrl, params.provider);
}

export function getCatalog() {
  const byCategory = {
    search: providers.filter((provider) => provider.category === "search"),
    news: providers.filter((provider) => provider.category === "news"),
    scrape: providers.filter((provider) => provider.category === "scrape")
  };

  return {
    updatedAt: new Date().toISOString(),
    providerCount: providers.length,
    providers,
    byCategory
  };
}
