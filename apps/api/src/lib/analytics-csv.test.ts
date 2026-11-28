import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { UsageEvent } from "@query402/shared";
import {
  USAGE_EVENT_CSV_COLUMNS,
  buildUsageEventsCsv,
  escapeCsvCell,
  neutralizeSpreadsheetFormula
} from "./analytics-csv.js";

interface CsvFixture {
  description: string;
  rows: UsageEvent[];
}

function loadFixture(name: "malicious" | "benign"): CsvFixture {
  const fixtureUrl = new URL(`../../tests/fixtures/analytics-csv/${name}.json`, import.meta.url);
  return JSON.parse(fs.readFileSync(fixtureUrl, "utf8")) as CsvFixture;
}

describe("neutralizeSpreadsheetFormula", () => {
  it("prefixes every formula trigger with an apostrophe", () => {
    expect(neutralizeSpreadsheetFormula("=1+1")).toBe("'=1+1");
    expect(neutralizeSpreadsheetFormula("+1+1")).toBe("'+1+1");
    expect(neutralizeSpreadsheetFormula("-2+3")).toBe("'-2+3");
    expect(neutralizeSpreadsheetFormula("@SUM(A1:A2)")).toBe("'@SUM(A1:A2)");
  });

  it("looks past optional leading whitespace", () => {
    expect(neutralizeSpreadsheetFormula("  =1+1")).toBe("'  =1+1");
    expect(neutralizeSpreadsheetFormula("\t+1+1")).toBe("'\t+1+1");
    expect(neutralizeSpreadsheetFormula("\r\n@SUM(A1)")).toBe("'\r\n@SUM(A1)");
  });

  it("leaves ordinary values untouched", () => {
    expect(neutralizeSpreadsheetFormula("search.basic")).toBe("search.basic");
    expect(neutralizeSpreadsheetFormula("/x402/search")).toBe("/x402/search");
    expect(neutralizeSpreadsheetFormula("trace_benign_1")).toBe("trace_benign_1");
    expect(neutralizeSpreadsheetFormula("")).toBe("");
    expect(neutralizeSpreadsheetFormula("   ")).toBe("   ");
    expect(neutralizeSpreadsheetFormula("a=1")).toBe("a=1");
  });
});

describe("escapeCsvCell", () => {
  it("quotes commas, quotes and line breaks per RFC 4180", () => {
    expect(escapeCsvCell("search, basic")).toBe('"search, basic"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("neutralizes formulas before quoting", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("=1,2")).toBe('"\'=1,2"');
    expect(escapeCsvCell('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
  });

  it("preserves typed values and empty cells", () => {
    expect(escapeCsvCell(0.01)).toBe("0.01");
    expect(escapeCsvCell(-5)).toBe("-5");
    expect(escapeCsvCell(false)).toBe("false");
    expect(escapeCsvCell(undefined)).toBe("");
    expect(escapeCsvCell(null)).toBe("");
  });
});

describe("buildUsageEventsCsv", () => {
  it("guards every user- or provider-derived column", () => {
    const guardedHeaders = USAGE_EVENT_CSV_COLUMNS.filter(
      (column) => column.neutralizeFormulas
    ).map((column) => column.header);

    expect(guardedHeaders).toEqual([
      "id",
      "mode",
      "endpoint",
      "providerId",
      "paymentStatus",
      "createdAt",
      "traceId",
      "payerHash"
    ]);
  });

  it("neutralizes cells from the malicious export fixture", () => {
    const { rows } = loadFixture("malicious");
    const csv = buildUsageEventsCsv(rows);
    const [header] = csv.split("\r\n");

    expect(header).toBe(
      "id,mode,endpoint,providerId,priceUsd,paymentStatus,createdAt,latencyMs,traceId,payerHash"
    );
    expect(csv).toContain("'+1+1");
    expect(csv).toContain("'-2+3");
    expect(csv).toContain("'  @SUM(A1:A2)");
    expect(csv).toContain("'\t=1+1");
    expect(csv).toContain('"\'=HYPERLINK(""https://attacker.example"",""click"")"');
    expect(csv).toContain("use_csv_malicious_1");
    // Query text and raw payer keys never reach the export.
    expect(csv).not.toContain("=cmd|");
    expect(csv).not.toContain(rows[0].payerPublicKey);
  });

  it("preserves benign values and ordinary CSV quoting", () => {
    const { rows } = loadFixture("benign");
    const csv = buildUsageEventsCsv(rows);

    expect(csv).toContain("use_csv_benign_1");
    expect(csv).toContain("search.basic");
    expect(csv).toContain("0.01");
    expect(csv).toContain('"/x402/scrape?q=hello,world"');
    expect(csv).toContain('"trace ""benign"""');
    expect(csv).not.toContain("'search.basic");
    expect(csv).not.toContain("'use_csv_benign_1");
  });

  it("returns only the header row for an empty export", () => {
    expect(buildUsageEventsCsv([])).toBe(
      "id,mode,endpoint,providerId,priceUsd,paymentStatus,createdAt,latencyMs,traceId,payerHash\r\n"
    );
  });
});
