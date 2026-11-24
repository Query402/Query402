import type {
  LatencyBucket,
  PaymentEvidence,
  PaymentProofLinks as SharedPaymentProofLinks,
  PrivacySafeAnalyticsResponse,
  ProviderDefinition,
  QueryMode,
  QueryResult
} from "@query402/shared";

/**
 * Public-safe projection of `paymentEvidenceSummary` from the API.
 *
 * Intentionally excludes:
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
  payer?: string;
  error?: string;
  proofLinks?: PaymentProofLinks;
}

export type PaymentProofLinks = SharedPaymentProofLinks;

// Re-export privacy-safe analytics for web usage
export type { PrivacySafeAnalyticsResponse };

export interface PaidQueryResponse {
  traceId: string;
  payment: {
    network: string;
    facilitatorUrl: string;
    evidence: PublicPaymentEvidence;
    /** Raw payment response header value captured at request time (redacted in receipts). */
    paymentResponseHeader?: string;
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

export interface HealthResponse {
  ok?: boolean;
  status?: string;
  service?: string;
  version?: string;
  nodeEnv?: string;
  uptimeSeconds?: number;
  network?: string;
  demoMode?: boolean;
  sponsorshipEnabled?: boolean;
  timestamp?: string;
  diagnostics?: {
    network: string;
    demoMode: boolean;
    facilitatorConfigured: boolean;
    facilitatorApiKeyConfigured: boolean;
    payToConfigured: boolean;
    sponsorshipEnabled: boolean;
    sponsorshipSigningSecretConfigured: boolean;
    anyProviderKeyConfigured: boolean;
    payToAddress?: string;
  };
  [key: string]: unknown;
}

export interface EvidenceCheckItem {
  id: string;
  label: string;
  status: "pass" | "warn" | "pending";
  detail?: string;
}
