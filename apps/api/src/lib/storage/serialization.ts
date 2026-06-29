import type {
  AnalyticsSummary,
  ExecutionFallbackReason,
  PaymentAttempt,
  QueryMode,
  UsageEvent
} from "@query402/shared";
import { DEFAULT_RECENT_LIMIT } from "./constants.js";
import type { AnalyticsQueryOptions } from "./types.js";

type UsageExecution = NonNullable<UsageEvent["execution"]>;

function emptySpendByCategory(): Record<QueryMode, number> {
  return { search: 0, news: 0, scrape: 0 };
}

function emptyExecutionSummary(): NonNullable<AnalyticsSummary["executionSummary"]> {
  return {
    totalExecutions: 0,
    liveExecutions: 0,
    fallbackExecutions: 0,
    unavailableExecutions: 0,
    timeoutExecutions: 0,
    circuitOpenExecutions: 0,
    fallbackByCategory: emptySpendByCategory(),
    fallbackReasonCounts: {
      timeout: 0,
      "circuit-open": 0,
      unhealthy: 0,
      "adapter-error": 0,
      "deterministic-provider": 0,
      "missing-fallback": 0
    }
  };
}

export function buildAnalyticsSummary(
  usage: UsageEvent[],
  payments: PaymentAttempt[],
  options?: AnalyticsQueryOptions
): AnalyticsSummary {
  const spendByCategory = usage.reduce<Record<QueryMode, number>>((acc, event) => {
    acc[event.mode] += event.priceUsd;
    return acc;
  }, emptySpendByCategory());

  const settledSpendByCategory = usage.reduce<Record<QueryMode, number>>((acc, event) => {
    if (event.paymentStatus === "settled") {
      acc[event.mode] += event.priceUsd;
    }
    return acc;
  }, emptySpendByCategory());

  const demoSpendByCategory = usage.reduce<Record<QueryMode, number>>((acc, event) => {
    if (event.paymentStatus === "demo-paid") {
      acc[event.mode] += event.priceUsd;
    }
    return acc;
  }, emptySpendByCategory());

  const settledSpendUsd = Number(
    Object.values(settledSpendByCategory)
      .reduce((sum, value) => sum + value, 0)
      .toFixed(6)
  );
  const demoSpendUsd = Number(
    Object.values(demoSpendByCategory)
      .reduce((sum, value) => sum + value, 0)
      .toFixed(6)
  );
  const failedSpendUsd = Number(
    usage
      .filter((event) => event.paymentStatus === "failed")
      .reduce((sum, event) => sum + event.priceUsd, 0)
      .toFixed(6)
  );
  const totalSpendUsd = Number(
    (spendByCategory.search + spendByCategory.news + spendByCategory.scrape).toFixed(6)
  );

  const executionSummary = usage.reduce<NonNullable<AnalyticsSummary["executionSummary"]>>(
    (acc, event) => {
      const execution = event.execution;
      if (!execution) {
        return acc;
      }

      acc.totalExecutions += 1;
      if (execution.source === "live") {
        acc.liveExecutions += 1;
      } else {
        acc.fallbackExecutions += 1;
        acc.fallbackByCategory[event.mode] += 1;
        const fallbackReason = execution.fallbackReason ?? "adapter-error";
        acc.fallbackReasonCounts[fallbackReason] += 1;

        if (execution.source === "unavailable") {
          acc.unavailableExecutions += 1;
        }
      }

      if (execution.fallbackReason === "timeout") {
        acc.timeoutExecutions += 1;
      }

      if (execution.circuitBreakerState === "open") {
        acc.circuitOpenExecutions += 1;
      }

      return acc;
    },
    emptyExecutionSummary()
  );

  const recentUsageLimit = options?.recentUsageLimit ?? DEFAULT_RECENT_LIMIT;
  const recentPaymentLimit = options?.recentPaymentLimit ?? DEFAULT_RECENT_LIMIT;

  return {
    totalQueries: usage.length,
    totalSpendUsd,
    settledSpendUsd,
    demoSpendUsd,
    failedSpendUsd,
    spendByCategory,
    settledSpendByCategory,
    demoSpendByCategory,
    executionSummary,
    recentTransactions: payments.slice(0, recentPaymentLimit),
    recentUsage: usage.slice(0, recentUsageLimit)
  };
}

export function usageEventToRow(event: UsageEvent) {
  return {
    id: event.id,
    mode: event.mode,
    endpoint: event.endpoint,
    provider_id: event.providerId,
    query_or_url: event.queryOrUrl,
    price_usd: event.priceUsd,
    network: event.network,
    payment_status: event.paymentStatus,
    payment_kind: event.paymentKind ?? null,
    payment_tx_hash: event.paymentTxHash ?? null,
    asset: event.asset ?? null,
    pay_to_address: event.payToAddress ?? null,
    amount: event.amount ?? null,
    facilitator_url: event.facilitatorUrl ?? null,
    payer_public_key: event.payerPublicKey ?? null,
    trace_id: event.traceId,
    created_at: event.createdAt,
    latency_ms: event.latencyMs,
    execution_source: event.execution?.source ?? null,
    execution_used_fallback: event.execution?.usedFallback ? 1 : 0,
    execution_fallback_reason: event.execution?.fallbackReason ?? null,
    execution_latency_estimate_ms: event.execution?.latencyEstimateMs ?? null,
    execution_observed_duration_ms: event.execution?.observedDurationMs ?? null,
    execution_circuit_breaker_state: event.execution?.circuitBreakerState ?? null,
    sponsorship_grant_id: event.sponsorshipGrantId ?? null,
    policy_decision: event.policyDecision ?? null,
    payment_source: event.paymentSource ?? null,
    sponsor_public_key: event.sponsorPublicKey ?? null
  };
}

export function rowToUsageEvent(row: Record<string, unknown>): UsageEvent {
  const hasExecutionMetadata =
    row.execution_source !== undefined ||
    row.execution_used_fallback !== undefined ||
    row.execution_fallback_reason !== undefined ||
    row.execution_latency_estimate_ms !== undefined ||
    row.execution_observed_duration_ms !== undefined ||
    row.execution_circuit_breaker_state !== undefined;

  return {
    id: String(row.id),
    mode: row.mode as QueryMode,
    endpoint: String(row.endpoint),
    providerId: String(row.provider_id),
    queryOrUrl: String(row.query_or_url),
    priceUsd: Number(row.price_usd),
    network: String(row.network),
    paymentStatus: row.payment_status as UsageEvent["paymentStatus"],
    paymentKind: row.payment_kind ? (row.payment_kind as UsageEvent["paymentKind"]) : undefined,
    paymentTxHash: row.payment_tx_hash ? String(row.payment_tx_hash) : undefined,
    asset: row.asset ? String(row.asset) : undefined,
    payToAddress: row.pay_to_address ? String(row.pay_to_address) : undefined,
    amount: row.amount ? String(row.amount) : undefined,
    facilitatorUrl: row.facilitator_url ? String(row.facilitator_url) : undefined,
    payerPublicKey: row.payer_public_key ? String(row.payer_public_key) : undefined,
    traceId: String(row.trace_id),
    createdAt: String(row.created_at),
    latencyMs: Number(row.latency_ms),
    execution: hasExecutionMetadata
      ? {
          providerId: String(row.provider_id),
          source: (row.execution_source ?? "unavailable") as UsageExecution["source"],
          usedFallback: Boolean(row.execution_used_fallback),
          fallbackReason: row.execution_fallback_reason
            ? (row.execution_fallback_reason as ExecutionFallbackReason)
            : undefined,
          latencyEstimateMs: Number(row.execution_latency_estimate_ms ?? row.latency_ms),
          observedDurationMs: Number(row.execution_observed_duration_ms ?? row.latency_ms),
          circuitBreakerState: row.execution_circuit_breaker_state
            ? (row.execution_circuit_breaker_state as UsageExecution["circuitBreakerState"])
            : undefined
        }
      : undefined,
    sponsorshipGrantId: row.sponsorship_grant_id ? String(row.sponsorship_grant_id) : undefined,
    policyDecision: row.policy_decision ? String(row.policy_decision) : undefined,
    paymentSource: row.payment_source
      ? (row.payment_source as UsageEvent["paymentSource"])
      : undefined,
    sponsorPublicKey: row.sponsor_public_key ? String(row.sponsor_public_key) : undefined
  };
}

export function paymentAttemptToRow(payment: PaymentAttempt) {
  return {
    id: payment.id,
    endpoint: payment.endpoint,
    provider_id: payment.providerId,
    amount_usd: payment.amountUsd,
    network: payment.network,
    asset: payment.asset ?? null,
    amount: payment.amount ?? null,
    evidence_kind: payment.evidenceKind ?? null,
    payer_public_key: payment.payerPublicKey ?? null,
    pay_to_address: payment.payToAddress,
    facilitator_url: payment.facilitatorUrl,
    status: payment.status,
    transaction_hash: payment.transactionHash ?? null,
    facilitator_result: payment.facilitatorResult
      ? JSON.stringify(payment.facilitatorResult)
      : null,
    error: payment.error ?? null,
    created_at: payment.createdAt,
    sponsorship_grant_id: payment.sponsorshipGrantId ?? null,
    policy_decision: payment.policyDecision ?? null,
    payment_source: payment.paymentSource ?? null,
    sponsor_public_key: payment.sponsorPublicKey ?? null
  };
}

export function rowToPaymentAttempt(row: Record<string, unknown>): PaymentAttempt {
  return {
    id: String(row.id),
    endpoint: String(row.endpoint),
    providerId: String(row.provider_id),
    amountUsd: Number(row.amount_usd),
    network: String(row.network),
    asset: row.asset ? String(row.asset) : undefined,
    amount: row.amount ? String(row.amount) : undefined,
    evidenceKind: row.evidence_kind
      ? (row.evidence_kind as PaymentAttempt["evidenceKind"])
      : undefined,
    payerPublicKey: row.payer_public_key ? String(row.payer_public_key) : undefined,
    payToAddress: String(row.pay_to_address),
    facilitatorUrl: String(row.facilitator_url),
    status: row.status as PaymentAttempt["status"],
    transactionHash: row.transaction_hash ? String(row.transaction_hash) : undefined,
    facilitatorResult: row.facilitator_result
      ? (JSON.parse(String(row.facilitator_result)) as Record<string, unknown>)
      : undefined,
    error: row.error ? String(row.error) : undefined,
    createdAt: String(row.created_at),
    sponsorshipGrantId: row.sponsorship_grant_id ? String(row.sponsorship_grant_id) : undefined,
    policyDecision: row.policy_decision ? String(row.policy_decision) : undefined,
    paymentSource: row.payment_source
      ? (row.payment_source as PaymentAttempt["paymentSource"])
      : undefined,
    sponsorPublicKey: row.sponsor_public_key ? String(row.sponsor_public_key) : undefined
  };
}
