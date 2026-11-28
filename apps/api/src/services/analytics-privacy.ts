import type { PrivacySafeAnalyticsRecord, UsageEvent } from "@query402/shared";
import {
  sanitizeAnalyticsEventForStorage,
  type AnalyticsPrivacyResult
} from "../lib/analytics-privacy.js";

export function formatPrivacySafeAnalytics(rawRecords: any[]): PrivacySafeAnalyticsRecord[] {
  return rawRecords.map(record => {
    // Note: mapping fields to match UsageEvent structure from persistence.ts
    const rawAddress = record.payerAddress || '';
    const redactedAddress = rawAddress.length > 8 
      ? `${rawAddress.slice(0, 4)}...${rawAddress.slice(-4)}`
      : 'Confidential';

    return {
      id: record.id?.toString() || '',
      timestamp: record.timestamp || new Date().toISOString(),
      payerAddress: redactedAddress,
      volumeType: record.mode === 'demo' ? 'demo' : 'settled',
      amount: Number(record.priceUsd || 0),
      asset: 'XLM'
    };
  });
}

/**
 * Service-layer entry point: run every analytics write candidate through the privacy helper.
 */
export function prepareAnalyticsEventForPersistence(
  event: UsageEvent | (UsageEvent & Record<string, unknown>)
): AnalyticsPrivacyResult<UsageEvent> {
  return sanitizeAnalyticsEventForStorage(event);
}