import { describe, expect, it } from "vitest";
import { formatSummary, type SummaryInput } from "./cli.js";
import { exec } from "child_process";
import { promisify } from "util";
import { resolve } from "path";

const execAsync = promisify(exec);
// Workaround for Windows cross-platform testing
const tsx = process.platform === "win32" ? "npx.cmd tsx" : "npx tsx";
const cliPath = resolve(__dirname, "cli.ts");

describe("CLI Validation", () => {
  it("exits with clear message when query is missing for search mode", async () => {
    try {
      await execAsync(`${tsx} "${cliPath}" search`);
      expect.fail("Should have failed");
    } catch (error: any) {
      expect(error.code).toBe(1);
      expect(error.stderr).toContain("Missing query for search mode.");
      expect(error.stdout).toContain("Usage:");
    }
  });

  it("exits with clear message when URL is missing for scrape mode (with flag)", async () => {
    try {
      await execAsync(`${tsx} "${cliPath}" scrape --provider scrape.page`);
      expect.fail("Should have failed");
    } catch (error: any) {
      expect(error.code).toBe(1);
      expect(error.stderr).toContain("Missing URL for scrape mode.");
      expect(error.stdout).toContain("Usage:");
    }
  });

  it("exits with clear message when query is missing for news mode", async () => {
    try {
      await execAsync(`${tsx} "${cliPath}" news`);
      expect.fail("Should have failed");
    } catch (error: any) {
      expect(error.code).toBe(1);
      expect(error.stderr).toContain("Missing query for news mode.");
      expect(error.stdout).toContain("Usage:");
    }
  });
});

describe("formatSummary", () => {
  const base: SummaryInput = {
    mode: "search",
    provider: "search.basic",
    isDemoMode: true,
    status: 200,
    priceUsd: "0.001",
    asset: "USDC",
    traceId: "trace-abc-123",
    evidenceId: "ev-xyz-789",
    latencyMs: 342,
  };

  it("includes mode and provider", () => {
    const out = formatSummary(base);
    expect(out).toContain("search");
    expect(out).toContain("search.basic");
  });

  it("marks client as demo when isDemoMode is true", () => {
    expect(formatSummary({ ...base, isDemoMode: true })).toContain("demo");
  });

  it("marks client as real when isDemoMode is false", () => {
    expect(formatSummary({ ...base, isDemoMode: false })).toContain("real");
  });

  it("includes price and asset when present", () => {
    const out = formatSummary(base);
    expect(out).toContain("0.001");
    expect(out).toContain("USDC");
  });

  it("includes trace id when present", () => {
    expect(formatSummary(base)).toContain("trace-abc-123");
  });

  it("includes evidence id when present", () => {
    expect(formatSummary(base)).toContain("ev-xyz-789");
  });

  it("includes latency when provided", () => {
    expect(formatSummary(base)).toContain("342ms");
  });

  it("omits latency row entirely when latencyMs is not provided", () => {
    const { latencyMs: _, ...noLatency } = base;
    expect(formatSummary(noLatency)).not.toContain("Latency");
  });

  it("shows unavailable for missing traceId", () => {
    const out = formatSummary({ ...base, traceId: undefined });
    expect(out).toContain("unavailable");
  });

  it("shows unavailable for missing evidenceId", () => {
    const out = formatSummary({ ...base, evidenceId: undefined });
    expect(out).toContain("unavailable");
  });

  it("shows n/a for missing price", () => {
    expect(formatSummary({ ...base, priceUsd: undefined })).toContain("n/a");
  });

  it("shows n/a for missing asset", () => {
    expect(formatSummary({ ...base, asset: undefined })).toContain("n/a");
  });

  it("never leaks raw payment headers or secrets", () => {
    const out = formatSummary({ ...base, evidenceId: "ev-xyz-789" });
    expect(out).not.toMatch(/payment-response/i);
    expect(out).not.toMatch(/Authorization/i);
    expect(out).not.toMatch(/Bearer /i);
  });

  it("produces deterministic output for the same input", () => {
    expect(formatSummary(base)).toBe(formatSummary(base));
  });
});
