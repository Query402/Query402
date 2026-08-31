import type {
  AnalyticsSummary,
  PaymentAttempt,
  UsageEvent,
  SettlementDigest
} from "@query402/shared";

export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export interface AnalyticsQueryOptions {
  recentUsageLimit?: number;
  recentPaymentLimit?: number;
}

export interface PaymentUsagePair {
  payment: PaymentAttempt;
  usage: UsageEvent;
}

export interface IdempotencyRecord {
  key: string;
  requestHash: string;
  responseJson: string;
  statusCode: number;
  expiresAt: string;
}

export type IdempotencyAcquireResult =
  | { state: "acquired" }
  | { state: "cached"; statusCode: number; body: unknown }
  | { state: "in_progress" };

export interface StorageRepository {
  isAvailable(): boolean;
  close(): void;

  saveUsageEvent(event: UsageEvent): Promise<void>;
  savePaymentAttempt(payment: PaymentAttempt): Promise<void>;
  persistPaymentAndUsage(pair: PaymentUsagePair): Promise<void>;

  getUsageEvents(options?: PaginationOptions): Promise<UsageEvent[]>;
  getPaymentAttempts(options?: PaginationOptions): Promise<PaymentAttempt[]>;
  getAnalyticsSummary(options?: AnalyticsQueryOptions): Promise<AnalyticsSummary>;
  getSettlementDigest(): Promise<SettlementDigest>;

  acquireIdempotencyLock(
    key: string,
    requestHash: string,
    ttlSeconds: number
  ): Promise<IdempotencyAcquireResult>;
  releaseIdempotencyLock(key: string): Promise<void>;
  cacheIdempotencyResponse(
    key: string,
    requestHash: string,
    statusCode: number,
    body: unknown,
    ttlSeconds: number
  ): Promise<void>;
  getCachedIdempotencyResponse(
    key: string,
    requestHash: string
  ): Promise<{ hit: true; statusCode: number; body: unknown } | { hit: false; conflict?: boolean }>;
}
