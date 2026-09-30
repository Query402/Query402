/** Default age at which dashboard data is considered stale. */
export const DEFAULT_TIMESTAMP_MAX_AGE_MS = 5 * 60 * 1000;

/** Parse an ISO timestamp without allowing invalid values to become "now". */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Return true only for timestamps in the half-open freshness window
 * `[now - maxAgeMs, now)`. Invalid, future, and exactly-expired timestamps are
 * stale by design, so callers never render malformed data as current.
 */
export function isFreshTimestamp(
  value: unknown,
  now: Date | number = Date.now(),
  maxAgeMs: number = DEFAULT_TIMESTAMP_MAX_AGE_MS
): boolean {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    return false;
  }

  const timestamp = parseTimestamp(value);
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (timestamp === null || !Number.isFinite(nowMs)) {
    return false;
  }

  const ageMs = nowMs - timestamp;
  return ageMs >= 0 && ageMs < maxAgeMs;
}

export function isStaleTimestamp(
  value: unknown,
  now: Date | number = Date.now(),
  maxAgeMs: number = DEFAULT_TIMESTAMP_MAX_AGE_MS
): boolean {
  return !isFreshTimestamp(value, now, maxAgeMs);
}

/**
 * Return true only for timestamps that are expired according to the shared
 * max age. The boundary is inclusive: a proof exactly `maxAgeMs` old is expired.
 * Invalid or future timestamps are also considered expired so callers never
 * serve or render malformed proofs.
 */
export function isPaymentProofFresh(input: {
  proofTimestamp: unknown;
  now?: Date | number;
  maxAgeMs?: number;
}): boolean {
  return isFreshTimestamp(input.proofTimestamp, input.now, input.maxAgeMs);
}

export function isExpiredTimestamp(
  value: unknown,
  now: Date | number = Date.now(),
  maxAgeMs: number = DEFAULT_TIMESTAMP_MAX_AGE_MS
): boolean {
  return !isFreshTimestamp(value, now, maxAgeMs);
}
