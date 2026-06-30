import type { ProviderDefinition, QueryMode, QueryResult } from "@query402/shared";

export interface PaidQueryResponse {
  traceId: string;
  payment: {
    network: string;
    facilitatorUrl: string;
    evidence?: {
      kind: string;
      status: string;
      network: string;
      asset?: string;
      amount?: string;
      payTo: string;
      facilitatorUrl: string;
      payer?: string;
      transactionHash?: string;
    };
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
