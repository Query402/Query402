/**
 * transcript.ts
 *
 * Deterministic demo-transcript generator for Query402.
 *
 * Companion to demo.ts — reuses the same runPaidQuery from client.ts
 * but writes a structured, redacted artifact to disk instead of
 * printing to the console.
 *
 * demo.ts       → interactive console output  (quick, visual)
 * transcript.ts → CI artifact on disk         (redacted, attestable)
 *
 * Usage:
 *   DEMO_MODE=true npm run demo:transcript --workspace @query402/agent-client
 *
 * Output:
 *   transcript/demo-transcript-<ISO>.json  (machine-readable)
 *   transcript/demo-transcript-<ISO>.txt   (human-readable)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { fileURLToPath } from "node:url";
import { runPaidQuery } from "./client.js";
import { config } from "./config.js";

// ---------------------------------------------------------------------------
// Output directory: repo-root/transcript/
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// src/ → agent-client/ → apps/ → repo-root/ → transcript/
const OUT_DIR = path.resolve(__dirname, "../../../transcript");

// ---------------------------------------------------------------------------
// Guard: refuse to run outside DEMO_MODE
// ---------------------------------------------------------------------------
if (config.DEMO_MODE !== "true") {
  console.error(
    "ERROR: Set DEMO_MODE=true to generate a transcript without live credentials."
  );
  process.exit(1);
}

const API_BASE = config.API_BASE_URL.replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------
const SECRET_PATTERNS: RegExp[] = [
  /S[A-Z0-9]{55}/g,        // Stellar secret key (starts with S, 56 chars)
  /Bearer\s+\S+/gi,        // Bearer tokens
  /x-payment:\s*\S+/gi,    // raw payment header value
  /X402-Payment:\s*\S+/gi,
];
const REDACTED = "[REDACTED]";

const SENSITIVE_HEADER_KEYS = new Set([
  "x-payment",
  "x402-payment",
  "authorization",
  "x-api-key",
  "payment-response",      // raw tx ID; replaced with presence flag below
]);

const SENSITIVE_OBJ_KEYS = new Set([
  "secret",
  "secret_key",
  "secretkey",
  "private_key",
  "privatekey",
  "api_key",
  "apikey",
]);

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    let s = value;
    for (const p of SECRET_PATTERNS) s = s.replace(p, REDACTED);
    return s;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lk = k.toLowerCase().replace(/[-\s]/g, "_");
      out[k] = SENSITIVE_OBJ_KEYS.has(lk) ? REDACTED : redact(v);
    }
    return out;
  }
  return value;
}

function safeHeaders(
  raw: Record<string, string | string[] | undefined>
): Record<string, string | undefined> {
  const safe: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    safe[k] = SENSITIVE_HEADER_KEYS.has(k.toLowerCase())
      ? REDACTED
      : Array.isArray(v)
        ? v.join(", ")
        : v;
  }
  return safe;
}

// ---------------------------------------------------------------------------
// Minimal HTTP GET (no extra deps beyond Node built-ins)
// ---------------------------------------------------------------------------
interface RawResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

function httpGet(url: string): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let raw = "";
      res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
      res.on("end", () => {
        let body: unknown;
        try { body = JSON.parse(raw); } catch { body = raw; }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    }).on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Transcript types
// ---------------------------------------------------------------------------
interface Step {
  step: string;
  timestamp: string;
  status: number | "n/a";
  responseHeaders?: Record<string, string | undefined>;
  body?: unknown;
  note?: string;
  error?: string;
}

interface Transcript {
  label: "DEMO_MODE";
  demo_mode: true;
  generated_at: string;
  api_base: string;
  settlement_network: string;
  warning: string;
  steps: Step[];
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function step1Health(): Promise<Step> {
  const timestamp = new Date().toISOString();
  try {
    const r = await httpGet(`${API_BASE}/health`);
    return {
      step: "1_health_check",
      timestamp,
      status: r.status,
      responseHeaders: safeHeaders(r.headers),
      body: redact(r.body),
      note:
        r.status === 200
          ? "API is healthy and ready."
          : "API responded but may not be fully ready.",
    };
  } catch (err) {
    return {
      step: "1_health_check",
      timestamp,
      status: "n/a",
      error: `Could not reach ${API_BASE}/health — is the API running? (${err})`,
      note: "Transcript is still written for CI evidence purposes.",
    };
  }
}

async function step2Catalog(): Promise<Step> {
  const timestamp = new Date().toISOString();
  try {
    const r = await httpGet(`${API_BASE}/api/catalog`);
    return {
      step: "2_provider_catalog",
      timestamp,
      status: r.status,
      responseHeaders: safeHeaders(r.headers),
      body: redact(r.body),
      note: "Available search/news/scrape providers with per-request pricing.",
    };
  } catch (err) {
    return {
      step: "2_provider_catalog",
      timestamp,
      status: "n/a",
      error: String(err),
    };
  }
}

/**
 * Runs the same three paid queries as demo.ts via the shared runPaidQuery
 * client — no duplication of payment logic.
 */
async function step3PaidQueries(): Promise<Step[]> {
  const queries: Array<Parameters<typeof runPaidQuery>[0]> = [
    { mode: "search",  provider: "search.pro",    query: "latest stellar x402 updates" },
    { mode: "news",    provider: "news.deep",      query: "stablecoin micropayments" },
    { mode: "scrape",  provider: "scrape.extract", url: "https://developers.stellar.org" },
  ];

  const steps: Step[] = [];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const timestamp = new Date().toISOString();
    const label = `3${String.fromCharCode(97 + i)}_demo_paid_${q.mode}`; // 3a_, 3b_, 3c_

    try {
      const response = await runPaidQuery(q);
      const payload = response.body as Record<string, unknown> | undefined;
      const result  = payload?.result as Record<string, unknown> | undefined;

      steps.push({
        step: label,
        timestamp,
        status: response.status,
        body: redact({
          provider:                q.provider,
          endpoint:                response.endpoint,
          // Never write the raw payment-response header value; record presence only
          payment_response_present: Boolean(response.paymentResponse),
          price_usd:               result?.priceUsd ?? "n/a",
          items_returned:          Array.isArray(result?.items) ? result.items.length : 0,
          result_body:             payload,
        }),
        note:
          "DEMO_MODE=true — payment header contains a placeholder tx ID; " +
          "no real Stellar transaction is submitted or settled.",
      });
    } catch (err) {
      steps.push({ step: label, timestamp, status: "n/a", error: String(err) });
    }
  }

  return steps;
}

function step4Metadata(paidSteps: Step[]): Step {
  const first = paidSteps.find((s) => s.status !== "n/a");
  const body  = first?.body as Record<string, unknown> | undefined;
  return {
    step: "4_response_metadata",
    timestamp: new Date().toISOString(),
    status: "n/a",
    body: {
      provider:           body?.provider ?? "search.pro",
      price_usd:          body?.price_usd ?? "n/a",
      settlement_network: "stellar:testnet",
      payment_status:     "DEMO — no real Stellar settlement",
      note:
        "In production this section contains the facilitator-signed " +
        "payment-response header. Here it is intentionally omitted.",
    },
    note: "Synthesised from paid-query responses. No secrets included.",
  };
}

async function step5Analytics(): Promise<Step> {
  const timestamp = new Date().toISOString();
  try {
    const r = await httpGet(`${API_BASE}/api/analytics`);
    return {
      step: "5_analytics_summary",
      timestamp,
      status: r.status,
      responseHeaders: safeHeaders(r.headers),
      body: redact(r.body),
      note: "Total spend + per-category breakdown stored in SQLite.",
    };
  } catch (err) {
    return {
      step: "5_analytics_summary",
      timestamp,
      status: "n/a",
      error: String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Assemble + write artifact
// ---------------------------------------------------------------------------
function assemble(steps: Step[]): Transcript {
  return {
    label: "DEMO_MODE",
    demo_mode: true,
    generated_at: new Date().toISOString(),
    api_base: API_BASE,
    settlement_network: "stellar:testnet",
    warning:
      "Generated in DEMO_MODE. No real Stellar credentials or live payments " +
      "were used. All secret fields are redacted. " +
      "Safe to attach to Drips/SCF updates and investor notes.",
    steps,
  };
}

function toText(t: Transcript): string {
  const bar = "─".repeat(70);
  const lines = [
    bar,
    `  QUERY402 DEMO TRANSCRIPT  [${t.label}]`,
    bar,
    `  Generated : ${t.generated_at}`,
    `  API       : ${t.api_base}`,
    `  Network   : ${t.settlement_network}`,
    `  ⚠  ${t.warning}`,
    bar,
    "",
  ];
  for (const s of t.steps) {
    lines.push(`▶ ${s.step}`);
    lines.push(`  Timestamp : ${s.timestamp}`);
    lines.push(`  Status    : ${s.status}`);
    if (s.note)  lines.push(`  Note      : ${s.note}`);
    if (s.error) lines.push(`  ERROR     : ${s.error}`);
    if (s.body) {
      lines.push("  Body:");
      JSON.stringify(s.body, null, 2)
        .split("\n")
        .forEach((l) => lines.push("    " + l));
    }
    lines.push("");
  }
  lines.push(bar, "  END OF DEMO TRANSCRIPT", bar);
  return lines.join("\n");
}

function writeArtifact(t: Transcript): { json: string; txt: string } {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const slug = t.generated_at.replace(/[:.]/g, "-").replace("T", "_");
  const jsonPath = path.join(OUT_DIR, `demo-transcript-${slug}.json`);
  const txtPath  = path.join(OUT_DIR, `demo-transcript-${slug}.txt`);

  fs.writeFileSync(jsonPath, JSON.stringify(t, null, 2), "utf8");
  fs.writeFileSync(txtPath,  toText(t),                  "utf8");
  return { json: jsonPath, txt: txtPath };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("▶ Query402 transcript generator  [DEMO_MODE=true]");
  console.log(`  API: ${API_BASE}`);
  console.log("");

  const allSteps: Step[] = [];

  console.log("  [1/5] Health check…");
  allSteps.push(await step1Health());

  console.log("  [2/5] Provider catalog…");
  allSteps.push(await step2Catalog());

  console.log("  [3/5] Demo paid requests (search / news / scrape)…");
  const paidSteps = await step3PaidQueries();
  allSteps.push(...paidSteps);

  console.log("  [4/5] Response metadata…");
  allSteps.push(step4Metadata(paidSteps));

  console.log("  [5/5] Analytics summary…");
  allSteps.push(await step5Analytics());

  const transcript = assemble(allSteps);
  const { json, txt } = writeArtifact(transcript);

  console.log("");
  console.log("✅ Transcript written:");
  console.log(`   JSON : ${json}`);
  console.log(`   TXT  : ${txt}`);
  console.log("");
  console.log("   Label   : DEMO_MODE  (safe for SCF / Drips / investor notes)");
  console.log("   Secrets : all redacted");
  console.log("   Payment : no real Stellar transaction");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});