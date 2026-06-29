import type {
  ProviderExecutionMetadata,
  ProviderResultItem,
  SourceType
} from "@query402/shared";

export interface ProviderAdapter {
  /** The unique ID of the provider */
  readonly id: string;

  /** Return true if the provider considers itself healthy/available */
  isHealthy(): Promise<boolean>;

  /** Execute the provider logic */
  execute(queryOrUrl: string): Promise<ProviderResultItem[]>;

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
    queryOrUrl: string
  ): Promise<AdapterExecutionResult>;
}
