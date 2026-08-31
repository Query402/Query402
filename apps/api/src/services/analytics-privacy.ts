import { PrivacySafeAnalyticsRecord } from "@query402/shared";

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