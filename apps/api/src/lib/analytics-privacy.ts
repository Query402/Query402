import crypto from "node:crypto";

/**
 * Hash a payer public key for privacy-safe display
 * Uses SHA256 to create a consistent hash that cannot be reversed
 */
export function hashPayerKey(payerPublicKey: string | undefined): string | undefined {
  if (!payerPublicKey) {
    return undefined;
  }
  return crypto
    .createHash("sha256")
    .update(payerPublicKey)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Check if a record is within the retention period
 */
export function isWithinRetention(createdAt: string, retentionDays: number): boolean {
  const created = new Date(createdAt);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return created >= cutoff;
}

/**
 * Encode cursor as base64
 */
export function encodeCursor(data: { timestamp: string; id: string }): string {
  const json = JSON.stringify(data);
  return Buffer.from(json).toString("base64");
}

/**
 * Decode cursor from base64
 */
export function decodeCursor(cursor: string): { timestamp: string; id: string } | null {
  try {
    const json = Buffer.from(cursor, "base64").toString("utf-8");
    const data = JSON.parse(json);
    if (data.timestamp && data.id) {
      return data;
    }
  } catch {
    // Invalid cursor
  }
  return null;
}

/**
 * Generate next cursor for pagination
 */
export function generateNextCursor(records: Array<{ createdAt: string; id: string }>): string | undefined {
  if (records.length === 0) {
    return undefined;
  }
  const lastRecord = records[records.length - 1];
  return encodeCursor({
    timestamp: lastRecord.createdAt,
    id: lastRecord.id
  });
}
