import type { LatencyBucket, ProviderDefinition, QueryMode, QueryResult } from "@query402/shared";

/**
 * Public-safe projection of `paymentEvidenceSummary` from the API.
 *
 * Intentionally excludes:
 *  - `payer` wallet address (would leak a specific signer in a public SCF issue)
 *  - `facilitatorResult` payload (could contain signed auth entries)
 *  - grant signatures, grant headers, raw payment headers, secrets
 *
 * All other fields are populated by the API contract (idempotency/x402.ts
 * `buildPaidResponse`). The receipt builder downgrades any missing value to
 * `null` so the exported JSON stays diff-friendly.
 */
export interface PublicPaymentEvidence {
  kind: "demo" | "verified" | "settled" | "failed";
  status: "demo-paid" | "verified" | "settled" | "failed" | "settlement-pending";
  network: string;
  asset?: string;
  amount?: string;
  payTo?: string;
  facilitatorUrl?: string;
  transactionHash?: string;
}

export interface PaidQueryResponse {
  traceId: string;
  payment: {
    network: string;
    facilitatorUrl: string;
    evidence: PublicPaymentEvidence;
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
  totalDemoQueries: number;
  totalSettledPayments: number;
  spendByPaymentSource: Record<string, number>;
  recentDemoActivity: Array<{
    id: string;
    amountUsd: number;
    endpoint: string;
    providerId: string;
    status: string;
    createdAt: string;
    paymentSource?: string;
  }>;
  recentSettledPayments: Array<{
    id: string;
    amountUsd: number;
    endpoint: string;
    providerId: string;
    status: string;
    createdAt: string;
    transactionHash?: string;
    paymentSource?: string;
  }>;
  recentTransactions: Array<{
    id: string;
    amountUsd: number;
    endpoint: string;
    providerId: string;
    evidence: PaymentEvidence;
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
    evidence: PaymentEvidence;
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

// Re-export privacy-safe analytics for web usage
export type { PrivacySafeAnalyticsResponse };
