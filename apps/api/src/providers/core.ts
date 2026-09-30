import type { ProviderExecutionMetadata, ProviderResultItem, SourceType } from "@query402/shared";

/**
 * Context required for paid query providers (news, search).
 * Ensures the provider is only called after payment and safety validation.
 */
export interface PaidQueryContext {
  /** Reference to the payment proof (transaction hash or demo proof key) */
  paymentReference: string;
  /** Whether URL safety validation passed (when applicable) */
  safetyPassed: boolean;
}

export interface ProviderAdapter {
  /** The unique ID of the provider */
  readonly id: string;

  /** Return true if the provider considers itself healthy/available */
  isHealthy(): Promise<boolean>;

  /** Execute the provider logic */
  execute(queryOrUrl: string, context?: PaidQueryContext): Promise<ProviderResultItem[]>;

  /** Return deterministic fallback data if the primary execution fails */
  getFallback?(queryOrUrl: string): ProviderResultItem[];
}

export interface AdapterExecutionResult {
  items: ProviderResultItem[];
  source: SourceType;
  execution: ProviderExecutionMetadata;
}

export interface ProviderRegistry {
  register(adapter: ProviderAdapter): void;
  execute(
    mode: "search" | "news" | "scrape",
    providerId: string,
    queryOrUrl: string,
    contextOrUnits?: PaidQueryContext | number
  ): Promise<AdapterExecutionResult>;
}
