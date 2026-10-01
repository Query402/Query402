import { providers, validateProviderCatalog } from "../lib/pricing.js";

/**
 * Public-safe view of a provider. Deliberately excludes execution details,
 * adapter config, and any result payload.
 */
export interface ProviderMetadata {
  id: string;
  name: string;
  price: number;
}

/**
 * Metadata-only accessor for the provider catalog. This module must not
 * import the registry executor or any search/news/scrape adapter so public
 * routes can depend on it without pulling in provider execution code.
 */
export function listProviderMetadata(): ProviderMetadata[] {
  validateProviderCatalog();
  return providers
    .filter((provider) => provider.enabled)
    .map((provider) => ({ id: provider.id, name: provider.name, price: provider.priceUsd }));
}
