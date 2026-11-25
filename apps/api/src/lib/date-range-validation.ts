/**
 * Shared date-range validation for analytics endpoints.
 *
 * Enforces a documented maximum date-range window and rejects reversed or
 * oversized ranges with a stable 400 error payload before the request reaches
 * the query layer.
 *
 * ## Configuration
 *
 * MAX_DATE_RANGE_DAYS defines the maximum allowed window between start and end
 * dates (inclusive). Requests spanning a larger window are rejected.
 *
 * Documented maximum: 90 days
 *   - Matches the analytics retention window so queries stay bounded to the
 *     period for which sensitive fields are still available.
 *
 * Stable error payload shape:
 *   { error: "invalid_date_range", message: string, [detail?: string] }
 */

/** Documented maximum analytics query window (days). */
export const MAX_DATE_RANGE_DAYS = 90;

/** Stable error payload for reversed ranges (end before start). */
export const REVERSED_DATE_RANGE_ERROR = {
  error: "invalid_date_range",
  message: "End date must be on or after the start date"
} as const;

/** Stable error payload for ranges exceeding the maximum window. */
export const OVERSIZED_DATE_RANGE_ERROR = {
  error: "invalid_date_range",
  message: `Date range exceeds the maximum allowed window of ${MAX_DATE_RANGE_DAYS} days`
} as const;

/**
 * Result of validating a date range.
 *
 * When `ok` is false the endpoint should respond with 400 using the attached
 * error payload. When `ok` is true the parsed dates are safe to pass to the
 * query layer.
 */
export type DateRangeValidationResult =
  | { ok: true; startDate: Date; endDate: Date }
  | { ok: false; error: typeof REVERSED_DATE_RANGE_ERROR | typeof OVERSIZED_DATE_RANGE_ERROR };

/**
 * Validate a date range used by analytics endpoints.
 *
 * Accepts ISO 8601 date or datetime strings (for example "2024-01-15" or
 * "2024-01-15T10:00:00Z"). Missing bounds are treated as "unbounded" on that
 * side and are not subject to the maximum-window check on their own.
 *
 * Returns a stable 400-style error when:
 * - `endDate` is before `startDate` (reversed range)
 * - the span between `startDate` and `endDate` exceeds MAX_DATE_RANGE_DAYS
 *
 * Missing start or end dates are allowed; only the intersection of the two
 * bounds is validated.
 */
export function validateDateRange(
  startDate?: string | null,
  endDate?: string | null
): DateRangeValidationResult {
  // No bounds to validate when either side is missing.
  if (!startDate && !endDate) {
    return { ok: true, startDate: new Date(), endDate: new Date() };
  }

  let start: Date | undefined;
  let end: Date | undefined;

  if (startDate) {
    start = parseDateIso(startDate);
    if (!start) {
      return {
        ok: false,
        error: {
          error: "invalid_date_range",
          message: "start_date must be a valid ISO 8601 date or datetime"
        }
      };
    }
  }

  if (endDate) {
    end = parseDateIso(endDate);
    if (!end) {
      return {
        ok: false,
        error: {
          error: "invalid_date_range",
          message: "end_date must be a valid ISO 8601 date or datetime"
        }
      };
    }
  }

  // Reversed range check only makes sense when both bounds are present.
  if (start && end) {
    if (end.getTime() < start.getTime()) {
      return { ok: false, error: REVERSED_DATE_RANGE_ERROR };
    }

    const diffDays = (end.getTime() - start.getTime()) / MS_PER_DAY;
    if (diffDays > MAX_DATE_RANGE_DAYS) {
      return { ok: false, error: OVERSIZED_DATE_RANGE_ERROR };
    }
  }

  return {
    ok: true,
    startDate: start ?? new Date(0),
    endDate: end ?? new Date()
  };
}

/**
 * Parse an ISO 8601 date or datetime string into a Date.
 *
 * Accepts both date-only strings ("2024-01-15") and datetime strings
 * ("2024-01-15T10:00:00Z"). Returns undefined for unparsable input.
 */
function parseDateIso(value: string): Date | undefined {
  const trimmed = value.trim();
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
}

/** Milliseconds in one day, used for window calculations. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
