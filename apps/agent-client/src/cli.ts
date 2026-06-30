import { runPaidQuery } from "./client.js";

export type QueryMode = "search" | "news" | "scrape";

export interface SummaryInput {
  mode: QueryMode;
  provider: string;
  isDemoMode: boolean;
  status: number;
  priceUsd?: string | number;
  asset?: string;
  traceId?: string;
  evidenceId?: string;
  latencyMs?: number;
}

/** Formats the post-query summary table. Pure function — safe to unit-test directly. */
export function formatSummary(input: SummaryInput): string {
  const rows: [string, string][] = [
    ["Mode",        input.mode],
    ["Provider",    input.provider],
    ["Status",      String(input.status)],
    ["Client",      input.isDemoMode ? "demo" : "real"],
    ["Price (USD)", input.priceUsd != null ? String(input.priceUsd) : "n/a"],
    ["Asset",       input.asset ?? "n/a"],
    ["Trace ID",    input.traceId ?? "unavailable"],
    ["Evidence ID", input.evidenceId ?? "unavailable"],
  ];
  if (input.latencyMs != null) {
    rows.push(["Latency", `${input.latencyMs}ms`]);
  }
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const body = rows
    .map(([label, value]) => `  ${label.padEnd(labelWidth)}  ${value}`)
    .join("\n");
  const divider = "=".repeat(labelWidth + 4 + 20);
  return `\n=== Query402 Paid Query Summary ===\n${body}\n${divider}`;
}

function usage() {
  console.log("Usage:");
  console.log('  npm run cli -- search "latest soroban updates" --provider search.basic');
  console.log('  npm run cli -- news "stablecoin micropayments" --provider news.fast');
  console.log('  npm run cli -- scrape "https://example.com" --provider scrape.page');
}

function readArg(flag: string, args: string[]) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const modeArg = args[0];
  const term = args[1];

  if (!modeArg || !["search", "news", "scrape"].includes(modeArg)) {
    usage();
    process.exit(1);
  }

  const mode = modeArg as QueryMode;

  if (!term || term.startsWith("--")) {
    if (mode === "scrape") {
      console.error("Missing URL for scrape mode.\n");
    } else {
      console.error(`Missing query for ${mode} mode.\n`);
    }
    usage();
    process.exit(1);
  }

  const provider =
    readArg("--provider", args) ??
    (mode === "search" ? "search.basic" : mode === "news" ? "news.fast" : "scrape.page");

  const start = Date.now();
  const result = await runPaidQuery({
    mode,
    provider,
    query: mode === "scrape" ? undefined : term,
    url: mode === "scrape" ? term : undefined
  });
  const latencyMs = Date.now() - start;

  const payload = result.body as Record<string, unknown>;
  const resultBlock = (payload?.result ?? (payload?.body as Record<string, unknown>)?.result) as Record<string, unknown> | undefined;
  const evidenceBlock = (payload?.payment as Record<string, unknown>)?.evidence as Record<string, unknown> | undefined;

  console.log(
    formatSummary({
      mode,
      provider,
      isDemoMode: result.isDemoMode,
      status: result.status,
      priceUsd: resultBlock?.priceUsd as string | number | undefined,
      asset: (evidenceBlock?.proofLinks as Record<string, string> | undefined)?.asset,
      traceId: resultBlock?.traceId as string | undefined,
      evidenceId: (evidenceBlock?.id ?? evidenceBlock?.evidenceId) as string | undefined,
      latencyMs,
    })
  );
}

import { fileURLToPath } from "node:url";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("CLI request failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
