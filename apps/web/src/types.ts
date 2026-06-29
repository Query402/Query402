import type { ProviderDefinition, QueryMode, QueryResult } from "@query402/shared";

export type ProofKind = "demo" | "verified" | "settled" | "failed";
export type ProofStatus = "demo-paid" | "verified" | "settled" | "failed" | "settlement-pending";

export interface PaymentEvidenceSummary {
  kind: ProofKind;
  status: ProofStatus;
  network?: string;
  asset?: string;
  amount?: string;
  payTo?: string;
  facilitatorUrl?: string;
  payer?: string;
  transactionHash?: string;
  capturedAt?: string;
}

export interface PaidQueryResponse {
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
  recentTransactions: Array<{
    id: string;
    amountUsd: number;
    endpoint: string;
    providerId: string;
    status: string;
    createdAt: string;
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
  }>;
}

export type ProviderMap = Record<QueryMode, ProviderDefinition[]>;
