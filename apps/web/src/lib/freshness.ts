import {
  DEFAULT_TIMESTAMP_MAX_AGE_MS,
  isFreshTimestamp,
  parseTimestamp
} from "@query402/shared";

export {
  DEFAULT_TIMESTAMP_MAX_AGE_MS,
  isExpiredTimestamp,
  isFreshTimestamp,
  isStaleTimestamp,
  parseTimestamp
} from "@query402/shared";

/** Web-client view of the shared proof window. Boundary timestamps are not fresh. */
export function isReceiptFresh(input: {
  proofTimestamp: unknown;
  now?: Date | number;
  maxAgeMs?: number;
}): boolean {
  return isFreshTimestamp(input.proofTimestamp, input.now, input.maxAgeMs);
}

/** Render a timestamp only when it is valid and within the dashboard window. */
export function formatFreshTimestamp(
  value: unknown,
  now: Date | number = Date.now(),
  maxAgeMs = DEFAULT_TIMESTAMP_MAX_AGE_MS
): string {
  if (!isFreshTimestamp(value, now, maxAgeMs)) {
    return "stale";
  }
  const timestamp = parseTimestamp(value);
  return timestamp === null ? "stale" : new Date(timestamp).toLocaleString();
}
