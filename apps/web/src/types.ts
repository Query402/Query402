import type { ProviderDefinition, QueryMode, QueryResult } from "@query402/shared";

// Discriminator union used by the freshness badge on the Control Deck. Stored
// fields on PaymentEvidenceSummary below stay typed as `string` so any new
// evidence kind can flow through without a type change. Exported here so the
// badge and helper can import a stable shape even if upstream-sync rewrites
// this file.
export type ProofKind = "demo" | "verified" | "settled" | "failed";

export interface PaymentProofLinks {
  transaction: string;
  payer: string;
  payTo: string;
  network: string;
  asset: string;
}

export interface PaymentEvidenceSummary {
  kind: string;
  status: string;
  network: string;
  asset?: string;
  amount?: string;
  payTo: string;
  facilitatorUrl: string;
  payer?: string;
  transactionHash?: string;
  /** Captured at evidence build time on the API. Drives the
   *  fresh/stale/unavailable badge in apps/web/src/components/FreshnessBadge.tsx.
   *  Older cached responses without this field render as `unavailable`. */
  capturedAt?: string;
  proofLinks: PaymentProofLinks;
}

export interface PaidQueryResponse {
  traceId: string;
  payment: {
    network: string;
    facilitatorUrl: string;
    paymentResponseHeader: string | null;
    evidence?: PaymentEvidenceSummary;
  };
  result: QueryResult;
}

export interface AnalyticsResponse {
  totalQueries: number;
  totalSpendUsd: number;
  spendByCategory: Record<QueryMode, number>;
  executionSummary: {
    totalExecutions: number;
    liveExecutions: number;
    fallbackExecutions: number;
    unavailableExecutions: number;
    timeoutExecutions: number;
    circuitOpenExecutions: number;
    fallbackByCategory: Record<QueryMode, number>;
    fallbackReasonCounts: Record<string, number>;
  };
  recentTransactions: Array<{
    id: string;
    amountUsd: number;
    endpoint: string;
    providerId: string;
    status: string;
    createdAt: string;
    transactionHash?: string;
    payerPublicKey?: string;
    payToAddress?: string;
    network: string;
    asset?: string;
  }>;
  recentUsage: Array<{
    id: string;
    mode: QueryMode;
    providerId: string;
    priceUsd: number;
    createdAt: string;
    latencyMs: number;
    paymentStatus: string;
    traceId: string;
    execution?: {
      providerId: string;
      source: string;
      usedFallback: boolean;
      fallbackReason?: string;
      latencyEstimateMs: number;
      observedDurationMs: number;
      circuitBreakerState?: string;
    };
    priceOutlier?: boolean;
    priceOutlierReason?: string;
  }>;
}

export type ProviderMap = Record<QueryMode, ProviderDefinition[]>;
