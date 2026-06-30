export type QueryMode = "search" | "news" | "scrape";
export type ProviderCategory = QueryMode;
export type SourceType = "live" | "deterministic-fallback" | "unavailable";
export type ExecutionFallbackReason =
  | "timeout"
  | "circuit-open"
  | "unhealthy"
  | "adapter-error"
  | "deterministic-provider"
  | "missing-fallback";
export type CircuitBreakerState = "closed" | "half-open" | "open";
export type PaymentSource = "sponsored" | "wallet" | "demo";

export interface ProviderExecutionMetadata {
  providerId: string;
  source: SourceType;
  usedFallback: boolean;
  fallbackReason?: ExecutionFallbackReason;
  latencyEstimateMs: number;
  observedDurationMs: number;
  circuitBreakerState?: CircuitBreakerState;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  category: ProviderCategory;
  priceUsd: number;
  description: string;
  latencyEstimateMs: number;
  qualityScore: number;
  sourceType: SourceType;
  enabled: boolean;
}

export interface ProviderResultItem {
  title: string;
  url: string;
  snippet: string;
  score: number;
}

export interface QueryResult {
  mode: QueryMode;
  providerId: string;
  providerName: string;
  priceUsd: number;
  latencyMs: number;
  timestamp: string;
  traceId: string;
  items: ProviderResultItem[];
  source: SourceType;
  execution: ProviderExecutionMetadata;
  raw?: Record<string, unknown>;
}

export interface UsageEvent {
  id: string;
  mode: QueryMode;
  endpoint: string;
  providerId: string;
  queryOrUrl: string;
  priceUsd: number;
  network: string;
  paymentStatus: "verified" | "settled" | "failed" | "demo-paid";
  paymentKind?: "demo" | "verified" | "settled" | "failed";
  paymentTxHash?: string;
  asset?: string;
  payToAddress?: string;
  amount?: string;
  facilitatorUrl?: string;
  payerPublicKey?: string;
  traceId: string;
  createdAt: string;
  latencyMs: number;
  execution?: ProviderExecutionMetadata;
  sponsorshipGrantId?: string;
  policyDecision?: string;
  paymentSource?: PaymentSource;
  sponsorPublicKey?: string;
}

export interface PaymentAttempt {
  id: string;
  endpoint: string;
  providerId: string;
  amountUsd: number;
  network: string;
  asset?: string;
  amount?: string;
  evidenceKind?: "demo" | "verified" | "settled" | "failed";
  payerPublicKey?: string;
  payToAddress: string;
  facilitatorUrl: string;
  status: "demo-paid" | "verified" | "settled" | "failed";
  transactionHash?: string;
  facilitatorResult?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  sponsorshipGrantId?: string;
  policyDecision?: string;
  paymentSource?: PaymentSource;
  sponsorPublicKey?: string;
}

export interface AnalyticsSummary {
  totalQueries: number;
  totalSpendUsd: number;
  settledSpendUsd: number;
  demoSpendUsd: number;
  failedSpendUsd: number;
  spendByCategory: Record<QueryMode, number>;
  settledSpendByCategory: Record<QueryMode, number>;
  demoSpendByCategory: Record<QueryMode, number>;
  executionSummary: {
    totalExecutions: number;
    liveExecutions: number;
    fallbackExecutions: number;
    unavailableExecutions: number;
    timeoutExecutions: number;
    circuitOpenExecutions: number;
    fallbackByCategory: Record<QueryMode, number>;
    fallbackReasonCounts: Record<ExecutionFallbackReason, number>;
  };
  recentTransactions: PaymentAttempt[];
  recentUsage: UsageEvent[];
}

export interface SponsorshipGrant {
  grantId: string;
  wallet: string;
  network: string;
  mode?: QueryMode;
  providerId?: string;
  maxAmountUsd: number;
  expiresAt: string;
  nonce: string;
  issuedAt: string;
}

export interface SignedGrant {
  grant: SponsorshipGrant;
  signature: string;
}

export interface SponsorshipChallenge {
  challengeId: string;
  wallet: string;
  message: string;
  expiresAt: string;
}

export interface SponsorshipPreviewBudget {
  limitUsd: number;
  spentUsd: number;
  remainingUsd: number;
  windowStart: string;
}

export interface SponsorshipPreviewRestrictions {
  mode: QueryMode | null;
  providerId: string | null;
}

export interface SponsorshipPreviewGrant {
  maxAmountUsd: number;
  ttlSeconds: number;
  expiresInSeconds: number;
  restrictions: SponsorshipPreviewRestrictions;
}

export interface SponsorshipPreview {
  sponsorshipEnabled: boolean;
  storageAvailable: boolean;
  available: boolean;
  decision: string;
  network: string;
  wallet: string;
  mode: QueryMode;
  provider: string;
  providerName: string;
  grant: SponsorshipPreviewGrant;
  quotedPriceUsd: number;
  priceFitsGrant: boolean;
  perWalletBudget: SponsorshipPreviewBudget;
  globalBudget: SponsorshipPreviewBudget;
  reason?: string;
}

export interface SponsorshipPreviewRequest {
  wallet: string;
  mode: QueryMode;
  provider: string;
}
