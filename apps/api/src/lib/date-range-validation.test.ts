import { describe, it, expect } from "vitest";
import {
  MAX_DATE_RANGE_DAYS,
  validateDateRange,
  REVERSED_DATE_RANGE_ERROR,
  OVERSIZED_DATE_RANGE_ERROR
} from "./date-range-validation.js";

describe("date-range-validation", () => {
  describe("MAX_DATE_RANGE_DAYS", () => {
    it("exports a documented maximum window", () => {
      expect(MAX_DATE_RANGE_DAYS).toBe(90);
    });
  });

  describe("error payloads", () => {
    it("exposes a stable reversed-range error shape", () => {
      expect(REVERSED_DATE_RANGE_ERROR).toEqual({
        error: "invalid_date_range",
        message: "End date must be on or after the start date"
      });
    });

    it("exposes a stable oversized-range error shape", () => {
      expect(OVERSIZED_DATE_RANGE_ERROR).toEqual({
        error: "invalid_date_range",
        message: `Date range exceeds the maximum allowed window of ${MAX_DATE_RANGE_DAYS} days`
      });
    });
  });

  describe("validateDateRange", () => {
    it("accepts missing bounds without error", () => {
      expect(validateDateRange(undefined, undefined).ok).toBe(true);
      expect(validateDateRange(null, undefined).ok).toBe(true);
      expect(validateDateRange(undefined, null).ok).toBe(true);
    });

    it("accepts a single bound without triggering the window check", () => {
      // Only start provided — no end to compare against.
      expect(validateDateRange("2024-01-01", undefined).ok).toBe(true);
      // Only end provided — no start to compare against.
      expect(validateDateRange(undefined, "2024-12-31").ok).toBe(true);
    });

    it("accepts an exact-boundary range (90 days)", () => {
      // Start at 2024-01-01, end exactly 90 days later (non-leap-year calculation).
      // Jan 1 + 90 days = Mar 31 in a non-leap year.
      // Use 2023 to avoid leap year confusion.
      const start = "2023-01-01";
      const end = "2023-03-31"; // 2023 is not a leap year, Jan 1 + 90 days = Mar 31.
      expect(validateDateRange(start, end).ok).toBe(true);
    });

    it("rejects a range just over the boundary (91 days)", () => {
      // Start at 2024-01-01, end 91 days later.
      const start = "2024-01-01";
      const end = "2024-04-02";
      const result = validateDateRange(start, end);
      expect(result.ok).toBe(false);
      expect(result.error).toBe(OVERSIZED_DATE_RANGE_ERROR);
    });

    it("rejects a reversed range (end before start)", () => {
      const result = validateDateRange("2024-04-01", "2024-01-01");
      expect(result.ok).toBe(false);
      expect(result.error).toBe(REVERSED_DATE_RANGE_ERROR);
    });

    it("accepts same-day ranges", () => {
      expect(validateDateRange("2024-06-01", "2024-06-01").ok).toBe(true);
    });

    it("accepts a short range well within the window", () => {
      expect(validateDateRange("2024-06-01", "2024-06-02").ok).toBe(true);
    });

    it("accepts datetime strings in addition to date-only strings", () => {
      // Use a date range that is exactly 90 days (2023 is not a leap year).
      expect(
        validateDateRange("2023-01-01T00:00:00Z", "2023-03-31T00:00:00Z").ok
      ).toBe(true);
    });

    it("rejects invalid start_date with a stable error shape", () => {
      const result = validateDateRange("not-a-date", "2024-12-31");
      expect(result.ok).toBe(false);
      expect(result.error.error).toBe("invalid_date_range");
      expect(result.error.message).toBe(
        "start_date must be a valid ISO 8601 date or datetime"
      );
    });

    it("rejects invalid end_date with a stable error shape", () => {
      const result = validateDateRange("2024-01-01", "not-a-date");
      expect(result.ok).toBe(false);
      expect(result.error.error).toBe("invalid_date_range");
      expect(result.error.message).toBe(
        "end_date must be a valid ISO 8601 date or datetime"
      );
    });

    it("returns parsed dates on success", () => {
      const result = validateDateRange("2024-06-01", "2024-06-02");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.startDate.getFullYear()).toBe(2024);
      expect(result.startDate.getMonth()).toBe(5); // June is month 5 (0-indexed)
      expect(result.startDate.getDate()).toBe(1);
      expect(result.endDate.getDate()).toBe(2);
    });

    it("rejects a multi-year range that far exceeds the maximum window", () => {
      const result = validateDateRange("2024-01-01", "2026-01-01");
      expect(result.ok).toBe(false);
      expect(result.error).toBe(OVERSIZED_DATE_RANGE_ERROR);
    });

    it("rejects end date just one millisecond past the maximum window", () => {
      const start = new Date("2024-01-01T00:00:00.000Z").getTime();
      const end = start + MAX_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000 + 1;
      const result = validateDateRange(
        "2024-01-01T00:00:00.000Z",
        new Date(end).toISOString()
      );
      expect(result.ok).toBe(false);
      expect(result.error).toBe(OVERSIZED_DATE_RANGE_ERROR);
    });

    it("accepts end date exactly at the maximum window boundary (to the millisecond)", () => {
      const start = new Date("2024-01-01T00:00:00.000Z").getTime();
      const end = start + MAX_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000;
      const result = validateDateRange(
        "2024-01-01T00:00:00.000Z",
        new Date(end).toISOString()
      );
      expect(result.ok).toBe(true);
    });

    it("trims whitespace from input strings", () => {
      // Use a date range that is exactly 90 days.
      expect(
        validateDateRange("  2023-01-01  ", "  2023-03-31  ").ok
      ).toBe(true);
    });
  });
});
