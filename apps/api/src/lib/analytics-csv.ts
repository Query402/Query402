import type { UsageEvent } from "@query402/shared";
import { hashPayerKey } from "./analytics-privacy.js";

/** Characters a spreadsheet treats as the start of a formula. */
const FORMULA_PREFIXES = new Set(["=", "+", "-", "@"]);

/**
 * Neutralize a cell that a spreadsheet could evaluate as a formula.
 *
 * Leading whitespace does not stop spreadsheet apps from parsing a value such
 * as ` =1+1`, so the guard looks past it. The leading apostrophe forces the
 * cell to be read as text instead of an expression.
 */
export function neutralizeSpreadsheetFormula(value: string): string {
  const firstNonWhitespace = value.trimStart().charAt(0);
  if (FORMULA_PREFIXES.has(firstNonWhitespace)) {
    return `'${value}`;
  }
  return value;
}

function quoteCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Escape one value for a CSV cell.
 *
 * Text is passed through the formula guard by default; typed numbers and
 * booleans keep their value. Quoting follows RFC 4180, so commas, quotes and
 * line breaks inside a value stay part of the same cell.
 */
export function escapeCsvCell(
  value: unknown,
  options: { neutralizeFormulas?: boolean } = {}
): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return quoteCsvField(String(value));
  }

  const text = String(value);
  return quoteCsvField(
    options.neutralizeFormulas === false ? text : neutralizeSpreadsheetFormula(text)
  );
}

export interface AnalyticsCsvColumn<T> {
  header: string;
  select: (row: T) => unknown;
  /**
   * True for columns whose values can be influenced by a user or provider.
   * Those columns always pass through the spreadsheet formula guard.
   */
  neutralizeFormulas: boolean;
}

/**
 * Serialize rows as an RFC 4180 CSV document with CRLF line endings.
 */
export function toCsv<T>(columns: AnalyticsCsvColumn<T>[], rows: T[]): string {
  const header = columns
    .map((column) => escapeCsvCell(column.header, { neutralizeFormulas: false }))
    .join(",");

  const body = rows.map((row) =>
    columns
      .map((column) =>
        escapeCsvCell(column.select(row), { neutralizeFormulas: column.neutralizeFormulas })
      )
      .join(",")
  );

  return `${[header, ...body].join("\r\n")}\r\n`;
}

/**
 * Public analytics export columns. Query text and raw payer keys are omitted;
 * `payerHash` carries the same truncated hash as the JSON analytics endpoints.
 */
export const USAGE_EVENT_CSV_COLUMNS: AnalyticsCsvColumn<UsageEvent>[] = [
  { header: "id", select: (event) => event.id, neutralizeFormulas: true },
  { header: "mode", select: (event) => event.mode, neutralizeFormulas: true },
  { header: "endpoint", select: (event) => event.endpoint, neutralizeFormulas: true },
  { header: "providerId", select: (event) => event.providerId, neutralizeFormulas: true },
  { header: "priceUsd", select: (event) => event.priceUsd, neutralizeFormulas: false },
  { header: "paymentStatus", select: (event) => event.paymentStatus, neutralizeFormulas: true },
  { header: "createdAt", select: (event) => event.createdAt, neutralizeFormulas: true },
  { header: "latencyMs", select: (event) => event.latencyMs, neutralizeFormulas: false },
  { header: "traceId", select: (event) => event.traceId, neutralizeFormulas: true },
  {
    header: "payerHash",
    select: (event) => hashPayerKey(event.payerPublicKey) ?? "",
    neutralizeFormulas: true
  }
];

/**
 * Build the analytics CSV export for a page of usage events.
 */
export function buildUsageEventsCsv(events: UsageEvent[]): string {
  return toCsv(USAGE_EVENT_CSV_COLUMNS, events);
}
