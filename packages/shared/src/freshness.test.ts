import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMESTAMP_MAX_AGE_MS,
  isFreshTimestamp,
  isStaleTimestamp,
  parseTimestamp
} from "./freshness.js";

describe("timestamp freshness", () => {
  const now = Date.parse("2026-08-31T12:00:00.000Z");

  it("treats missing and malformed values as stale", () => {
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp("not-a-date")).toBeNull();
    expect(isFreshTimestamp(undefined, now)).toBe(false);
    expect(isStaleTimestamp("not-a-date", now)).toBe(true);
  });

  it("uses an exclusive expiry boundary", () => {
    const boundary = new Date(now - DEFAULT_TIMESTAMP_MAX_AGE_MS).toISOString();
    expect(isFreshTimestamp(boundary, now)).toBe(false);
    expect(isFreshTimestamp(new Date(now - DEFAULT_TIMESTAMP_MAX_AGE_MS + 1).toISOString(), now)).toBe(
      true
    );
  });

  it("accepts current timestamps but rejects future timestamps", () => {
    expect(isFreshTimestamp(new Date(now - 1).toISOString(), now)).toBe(true);
    expect(isFreshTimestamp(new Date(now + 1).toISOString(), now)).toBe(false);
  });
});
