import type {
  CategoryMetrics,
  DetailedAnalyticsRecord,
  DetailedAnalyticsResponse,
  PrivacySafeAnalyticsAggregation,
  PrivacySafeAnalyticsResponse,
  PrivacySafeUsageRecord,
  SettlementMetrics,
  UsageEvent,
  PaymentAttempt,
  QueryMode
} from "@query402/shared";
import { decodeCursor, encodeCursor, generateNextCursor, hashPayerKey, isWithinRetention } from "./analytics-privacy.js";

interface AnalyticsServiceConfig {
  retentionDays: number;
  maxPageLimit: number;
  defaultPageLimit: number;
}

const DEFAULT_CONFIG: AnalyticsServiceConfig = {
  retentionDays: 90,
  maxPageLimit: 100,
  defaultPageLimit: 20
};

/**
 * Create empty metrics for initialization
 */
function createEmptyMetrics(): SettlementMetrics {
  return { count: 0, volumeUsd: 0 };
}

/**
 * Create empty category metrics
 */
function createEmptyCategoryMetrics(): CategoryMetrics {
  return {
    search: createEmptyMetrics(),
    news: createEmptyMetrics(),
    scrape: createEmptyMetrics()
  };
}

/**
 * Increment metrics by adding to count and volume
 */
function incrementMetrics(metrics: SettlementMetrics, priceUsd: number): void {
  metrics.count += 1;
  metrics.volumeUsd += priceUsd;
  // Round to 6 decimals to avoid floating point errors
  metrics.volumeUsd = Number(metrics.volumeUsd.toFixed(6));
}

/**
 * Determine settlement status from payment and usage records
 */
function getSettlementStatus(
  usage: UsageEvent,
  paymentMap: Map<string, PaymentAttempt>
): "demo-paid" | "verified" | "settled" | "failed" {
  if (usage.paymentStatus === "demo-paid") {
    return "demo-paid";
  }

  if (usage.paymentStatus === "failed") {
    return "failed";
  }

  // For paid status, check payment attempts
  const paymentId = usage.id.replace("use_", "pay_");
  const payment = paymentMap.get(paymentId);

  if (!payment) {
    // Fallback to usage status
    return usage.paymentStatus === "paid" ? "settled" : "failed";
  }

  return payment.status;
}

/**
 * Build a map of payment attempts by ID for quick lookup
 */
function buildPaymentMap(payments: PaymentAttempt[]): Map<string, PaymentAttempt> {
  const map = new Map<string, PaymentAttempt>();
  for (const payment of payments) {
    map.set(payment.id, payment);
  }
  return map;
}

/**
 * Aggregate usage and payment data into privacy-safe metrics
 */
function aggregateAnalytics(
  usage: UsageEvent[],
  payments: PaymentAttempt[],
  config: AnalyticsServiceConfig
): PrivacySafeAnalyticsAggregation {
  const aggregation: PrivacySafeAnalyticsAggregation = {
    demoPaid: {
      totalCount: 0,
      totalVolumeUsd: 0,
      byCategory: createEmptyCategoryMetrics()
    },
    verified: {
      totalCount: 0,
      totalVolumeUsd: 0,
      byCategory: createEmptyCategoryMetrics()
    },
    settled: {
      totalCount: 0,
      totalVolumeUsd: 0,
      byCategory: createEmptyCategoryMetrics()
    },
    failed: {
      totalCount: 0,
      totalVolumeUsd: 0,
      byCategory: createEmptyCategoryMetrics()
    }
  };

  const paymentMap = buildPaymentMap(payments);

  for (const event of usage) {
    const status = getSettlementStatus(event, paymentMap);
    const bucket = aggregation[status];

    bucket.totalCount += 1;
    bucket.totalVolumeUsd += event.priceUsd;
    bucket.totalVolumeUsd = Number(bucket.totalVolumeUsd.toFixed(6));

    incrementMetrics(bucket.byCategory[event.mode], event.priceUsd);
  }

  return aggregation;
}

/**
 * Convert usage event to privacy-safe record
 * Redacts sensitive fields based on retention policy
 */
function toPrivacySafeRecord(
  usage: UsageEvent,
  paymentMap: Map<string, PaymentAttempt>,
  config: AnalyticsServiceConfig
): PrivacySafeUsageRecord {
  // Determine if payer key should be included based on retention
  let payerHash: string | undefined;
  if (isWithinRetention(usage.createdAt, config.retentionDays) && usage.payerPublicKey) {
    payerHash = hashPayerKey(usage.payerPublicKey);
  }

  return {
    id: usage.id,
    mode: usage.mode,
    endpoint: usage.endpoint,
    providerId: usage.providerId,
    priceUsd: usage.priceUsd,
    paymentStatus: usage.paymentStatus === "demo-paid" ? "demo-paid" : usage.paymentStatus === "paid" ? "paid" : "failed",
    createdAt: usage.createdAt,
    latencyMs: usage.latencyMs,
    traceId: usage.traceId,
    payerHash
  };
}

/**
 * Convert usage event to detailed analytics record (authorized endpoints)
 * Still redacts payment payloads and full payer addresses
 */
function toDetailedRecord(
  usage: UsageEvent,
  paymentMap: Map<string, PaymentAttempt>,
  config: AnalyticsServiceConfig
): DetailedAnalyticsRecord {
  let payerKeyHash: string | undefined;
  let paymentTxHash: string | undefined;

  if (isWithinRetention(usage.createdAt, config.retentionDays)) {
    if (usage.payerPublicKey) {
      payerKeyHash = hashPayerKey(usage.payerPublicKey);
    }
    paymentTxHash = usage.paymentTxHash;
  }

  return {
    id: usage.id,
    mode: usage.mode,
    endpoint: usage.endpoint,
    providerId: usage.providerId,
    priceUsd: usage.priceUsd,
    paymentStatus: usage.paymentStatus === "demo-paid" ? "demo-paid" : usage.paymentStatus === "paid" ? "paid" : "failed",
    paymentTxHash,
    payerKeyHash,
    createdAt: usage.createdAt,
    latencyMs: usage.latencyMs,
    traceId: usage.traceId
  };
}

/**
 * Filter usage records by cursor position for pagination
 */
function filterByPagination(
  records: UsageEvent[],
  cursor?: string
): UsageEvent[] {
  if (!cursor) {
    return records;
  }

  const decoded = decodeCursor(cursor);
  if (!decoded) {
    return records;
  }

  const { timestamp, id } = decoded;
  const cursorTime = new Date(timestamp).getTime();

  return records.filter((record) => {
    const recordTime = new Date(record.createdAt).getTime();
    return recordTime < cursorTime || (recordTime === cursorTime && record.id < id);
  });
}

/**
 * Get public analytics response with privacy-safe aggregation and pagination
 */
export function getPublicAnalytics(
  usage: UsageEvent[],
  payments: PaymentAttempt[],
  cursorLimit: { cursor?: string; limit?: number } = {},
  config: AnalyticsServiceConfig = DEFAULT_CONFIG
): PrivacySafeAnalyticsResponse {
  const limit = Math.min(cursorLimit.limit ?? config.defaultPageLimit, config.maxPageLimit);
  const paymentMap = buildPaymentMap(payments);

  // Get aggregation for all records
  const aggregation = aggregateAnalytics(usage, payments, config);

  // Filter by cursor for pagination
  const paginatedRecords = filterByPagination(usage, cursorLimit.cursor);

  // Take limit + 1 to detect if there are more records
  const recordsToCheck = paginatedRecords.slice(0, limit + 1);
  const hasMore = recordsToCheck.length > limit;
  const records = recordsToCheck.slice(0, limit);

  const recentRecords = records.map((u) => toPrivacySafeRecord(u, paymentMap, config));

  const nextCursor = hasMore ? generateNextCursor(records) : undefined;

  return {
    aggregation,
    recentRecords,
    pagination: {
      cursor: cursorLimit.cursor || "start",
      limit,
      hasMore,
      nextCursor
    }
  };
}

/**
 * Get detailed analytics for authorized access
 * Includes transaction hashes and payer key hashes (redacted keys)
 */
export function getDetailedAnalytics(
  usage: UsageEvent[],
  payments: PaymentAttempt[],
  cursorLimit: { cursor?: string; limit?: number } = {},
  config: AnalyticsServiceConfig = DEFAULT_CONFIG
): DetailedAnalyticsResponse {
  const limit = Math.min(cursorLimit.limit ?? config.defaultPageLimit, config.maxPageLimit);
  const paymentMap = buildPaymentMap(payments);

  // Get aggregation for all records
  const aggregation = aggregateAnalytics(usage, payments, config);

  // Filter by cursor for pagination
  const paginatedRecords = filterByPagination(usage, cursorLimit.cursor);

  // Take limit + 1 to detect if there are more records
  const recordsToCheck = paginatedRecords.slice(0, limit + 1);
  const hasMore = recordsToCheck.length > limit;
  const records = recordsToCheck.slice(0, limit);

  const detailedRecords = records.map((u) => toDetailedRecord(u, paymentMap, config));

  const nextCursor = hasMore ? generateNextCursor(records) : undefined;

  return {
    aggregation,
    records: detailedRecords,
    pagination: {
      cursor: cursorLimit.cursor || "start",
      limit,
      hasMore,
      nextCursor
    }
  };
}

/**
 * Get configuration with defaults
 */
export function getAnalyticsConfig(overrides?: Partial<AnalyticsServiceConfig>): AnalyticsServiceConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides
  };
}
