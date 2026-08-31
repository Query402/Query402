import { describe, expect, it } from "vitest";
import { formatSummary, type SummaryInput } from "./cli.js";
import { exec } from "child_process";
import { promisify } from "util";
import { resolve } from "path";

const execAsync = promisify(exec);
// Workaround for Windows cross-platform testing
const tsx = process.platform === "win32" ? "npx.cmd --yes tsx" : "npx --yes tsx";
const cliPath = resolve(__dirname, "cli.ts");

/**
 * Run the CLI and return { code, stdout, stderr }.
 * Never throws — caller asserts on the returned fields.
 */
async function runCli(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const quotedArgs = args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ");
  try {
    const result = await execAsync(`${tsx} "${cliPath}" ${quotedArgs}`);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (err: any) {
    return {
      code: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? ""
    };
  }
}

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

  it("exits with error when query is missing with --receipt flag", async () => {
    try {
      await execAsync(`${tsx} "${cliPath}" search --receipt`);
      expect.fail("Should have failed");
    } catch (error: any) {
      expect(error.code).toBe(1);
      expect(error.stderr).toContain("Missing query for search mode.");
    }
  });

  it("exits with error when query is missing with --json flag", async () => {
    try {
      await execAsync(`${tsx} "${cliPath}" news --json`);
      expect.fail("Should have failed");
    } catch (error: any) {
      expect(error.code).toBe(1);
      expect(error.stderr).toContain("Missing query for news mode.");
    }
  });
});

// ---------------------------------------------------------------------------
// Exit-code contract tests (Issue #132)
// Covers: help, version, missing args, conflicting args, unknown args.
// Each test explicitly asserts stdout, stderr, and exit code.
// ---------------------------------------------------------------------------

describe("CLI exit-code contract", () => {
  // -------------------------------------------------------------------------
  // TEST 4 — Help
  // -------------------------------------------------------------------------
  it("--help exits 0 and prints usage to stdout with empty stderr", async () => {
    const { code, stdout, stderr } = await runCli("--help");

    expect(code).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("search");
    expect(stdout).toContain("news");
    expect(stdout).toContain("scrape");
    expect(stderr).toBe("");
  });

  it("-h exits 0 and prints usage to stdout with empty stderr", async () => {
    const { code, stdout, stderr } = await runCli("-h");

    expect(code).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stderr).toBe("");
  });

  // -------------------------------------------------------------------------
  // TEST 5 — Version
  // -------------------------------------------------------------------------
  it("--version exits 0 and prints version info to stdout with empty stderr", async () => {
    const { code, stdout, stderr } = await runCli("--version");

    expect(code).toBe(0);
    expect(stdout).toMatch(/query402/i);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/); // semver-like string
    expect(stderr).toBe("");
  });

  it("-V exits 0 and prints version info to stdout with empty stderr", async () => {
    const { code, stdout, stderr } = await runCli("-V");

    expect(code).toBe(0);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
    expect(stderr).toBe("");
  });

  // -------------------------------------------------------------------------
  // TEST 1 — Missing required argument: no arguments at all
  // -------------------------------------------------------------------------
  it("no arguments exits non-zero and prints usage to stdout with empty stderr", async () => {
    const { code, stdout, stderr } = await runCli();

    expect(code).not.toBe(0);
    expect(stdout).toContain("Usage:");
    // No mode argument: the error is shown in usage on stdout, not on stderr
    expect(stderr).toBe("");
  });

  it("search mode with no query exits non-zero, error on stderr, usage on stdout", async () => {
    const { code, stdout, stderr } = await runCli("search");

    expect(code).not.toBe(0);
    expect(stderr).toContain("Missing query for search mode.");
    expect(stdout).toContain("Usage:");
  });

  it("news mode with no query exits non-zero, error on stderr, usage on stdout", async () => {
    const { code, stdout, stderr } = await runCli("news");

    expect(code).not.toBe(0);
    expect(stderr).toContain("Missing query for news mode.");
    expect(stdout).toContain("Usage:");
  });

  it("scrape mode with no URL exits non-zero, error on stderr, usage on stdout", async () => {
    const { code, stdout, stderr } = await runCli("scrape");

    expect(code).not.toBe(0);
    expect(stderr).toContain("Missing URL for scrape mode.");
    expect(stdout).toContain("Usage:");
  });

  // -------------------------------------------------------------------------
  // TEST 2 — Conflicting arguments
  // Providing --provider without a query causes the parser to use the next
  // positional as the provider value, leaving the query position empty.
  // -------------------------------------------------------------------------
  it("search with --provider but no query exits non-zero with error on stderr", async () => {
    const { code, stdout, stderr } = await runCli("search", "--provider", "search.basic");

    expect(code).not.toBe(0);
    expect(stderr).toContain("Missing query for search mode.");
    expect(stdout).toContain("Usage:");
  });

  it("scrape with --provider but no URL exits non-zero with error on stderr", async () => {
    const { code, stdout, stderr } = await runCli("scrape", "--provider", "scrape.page");

    expect(code).not.toBe(0);
    expect(stderr).toContain("Missing URL for scrape mode.");
    expect(stdout).toContain("Usage:");
  });

  // -------------------------------------------------------------------------
  // TEST 3 — Unknown argument / mode
  // -------------------------------------------------------------------------
  it("unknown mode exits non-zero and prints usage to stdout with empty stderr", async () => {
    const { code, stdout, stderr } = await runCli("unknown-mode", "some query");

    expect(code).not.toBe(0);
    expect(stdout).toContain("Usage:");
    // Unknown mode: treated as invalid, no message on stderr
    expect(stderr).toBe("");
  });

  it("unknown flag as first argument exits non-zero and prints usage to stdout", async () => {
    const { code, stdout, stderr } = await runCli("--definitely-not-a-real-option");

    expect(code).not.toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stderr).toBe("");
  });

  it("unknown flag after valid mode exits non-zero with error on stderr", async () => {
    const { code, stdout, stderr } = await runCli("search", "--unknown-flag");

    expect(code).not.toBe(0);
    expect(stderr).toContain("Missing query for search mode.");
    expect(stdout).toContain("Usage:");
  });

  // -------------------------------------------------------------------------
  // Regression: invalid input must never silently succeed
  // -------------------------------------------------------------------------
  it("invalid input never exits with code 0 to prevent silent automation failures", async () => {
    const invalidInvocations = [
      [],
      ["unknown-mode"],
      ["search"],
      ["news"],
      ["scrape"],
      ["--definitely-not-a-real-option"],
      ["search", "--provider", "p"]
    ];

    for (const args of invalidInvocations) {
      const { code } = await runCli(...args);
      expect(code, `Expected non-zero exit for args: ${JSON.stringify(args)}`).not.toBe(0);
    }
  });
});

describe("redactInput", () => {
  it("returns short inputs unchanged", async () => {
    const { redactInput } = await import("./cli.js");
    expect(redactInput("short query")).toBe("short query");
    expect(redactInput("a".repeat(50))).toBe("a".repeat(50));
  });

  it("truncates long inputs with ellipsis", async () => {
    const { redactInput } = await import("./cli.js");
    const long = "a".repeat(100);
    expect(redactInput(long)).toBe("a".repeat(47) + "...");
  });
});

describe("buildReceipt", () => {
  it("builds correct receipt structure", async () => {
    const { buildReceipt } = await import("./cli.js");
    const receipt = buildReceipt({
      mode: "search",
      provider: "search.basic",
      term: "test query",
      price: 0.01,
      traceId: "trace_abc123"
    });

    expect(receipt).toEqual({
      command: "search",
      provider: "search.basic",
      input: "test query",
      price: 0.01,
      traceId: "trace_abc123"
    });
  });

  it("handles missing price and traceId", async () => {
    const { buildReceipt } = await import("./cli.js");
    const receipt = buildReceipt({
      mode: "scrape",
      provider: "scrape.page",
      term: "https://example.com"
    });

    expect(receipt).toEqual({
      command: "scrape",
      provider: "scrape.page",
      input: "https://example.com",
      price: null,
      traceId: null
    });
  });

  it("redacts long inputs in receipt", async () => {
    const { buildReceipt } = await import("./cli.js");
    const long = "a".repeat(100);
    const receipt = buildReceipt({
      mode: "search",
      provider: "search.basic",
      term: long,
      price: 0.05,
      traceId: "trace_xyz"
    });

    expect(receipt.input).toBe("a".repeat(47) + "...");
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
    latencyMs: 342
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
