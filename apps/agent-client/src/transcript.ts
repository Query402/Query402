/**
 * transcript.ts
 *
 * Deterministic demo-transcript generator for Query402, plus a schema-gated
 * agent receipt append path.
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
 * Append a schema-valid receipt line (fails closed on invalid receipts):
 *   npx tsx src/transcript.ts --append-receipt <receipt.json> \
 *     --provider <providerId> --transcript <path.jsonl>
 *
 * Output:
 *   transcript/demo-transcript-<ISO>.json  (machine-readable)
 *   transcript/demo-transcript-<ISO>.txt   (human-readable)
 *   transcript/agent-receipts.jsonl        (one validated receipt per line)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { fileURLToPath } from "node:url";
import { query402ReceiptSchema, type Query402Receipt } from "@query402/shared";
import { runPaidQuery } from "./client.js";
import { config } from "./config.js";

// ---------------------------------------------------------------------------
// Output directory: repo-root/transcript/
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// src/ → agent-client/ → apps/ → repo-root/ → transcript/
const OUT_DIR = path.resolve(__dirname, "../../../transcript");
const DEFAULT_AGENT_RECEIPT_TRANSCRIPT = path.join(OUT_DIR, "agent-receipts.jsonl");

const RECEIPT_SCHEMA_VERSION = "query402.receipt.v1";

/** Keys that must never appear in a written transcript line. */
const RAW_PAYMENT_HEADER_KEYS = new Set([
  "x-payment",
  "x402-payment",
  "payment-response",
  "paymentresponse",
  "payment_response",
  "paymentheader",
  "payment_header",
  "rawpaymentheader",
  "raw_payment_header"
]);

export type TranscriptRejectReason =
  | "unknown_version"
  | "missing_payment_reference"
  | "mismatched_provider"
  | "invalid_schema";

export class TranscriptValidationError extends Error {
  readonly reason: TranscriptRejectReason;

  constructor(reason: TranscriptRejectReason, message: string) {
    super(message);
    this.name = "TranscriptValidationError";
    this.reason = reason;
  }
}

/**
 * Payment reference used in the agent transcript: a settled transaction hash
 * when present, otherwise the query trace id. Never the raw payment header.
 */
export function paymentReferenceOf(receipt: Query402Receipt): string | null {
  const tx = receipt.payment.transactionHash;
  if (typeof tx === "string" && tx.trim().length > 0) {
    return tx.trim();
  }
  if (typeof receipt.traceId === "string" && receipt.traceId.trim().length > 0) {
    return receipt.traceId.trim();
  }
  return null;
}

function schemaVersionOf(value: unknown): unknown {
  if (value !== null && typeof value === "object" && "schema" in value) {
    return (value as { schema: unknown }).schema;
  }
  return undefined;
}

/**
 * Validate a receipt against the shared schema plus agent-transcript rules:
 * known schema version, a payment reference, and an expected provider id.
 */
export function validateReceiptForTranscript(
  receipt: unknown,
  expectedProvider: string
): Query402Receipt {
  const version = schemaVersionOf(receipt);
  if (version !== undefined && version !== RECEIPT_SCHEMA_VERSION) {
    throw new TranscriptValidationError(
      "unknown_version",
      `Unknown receipt schema version: ${String(version)}`
    );
  }

  const parsed = query402ReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    if (version === undefined || version !== RECEIPT_SCHEMA_VERSION) {
      throw new TranscriptValidationError(
        "unknown_version",
        `Receipt schema must be ${RECEIPT_SCHEMA_VERSION}`
      );
    }
    throw new TranscriptValidationError(
      "invalid_schema",
      `Receipt failed shared schema validation: ${parsed.error.message}`
    );
  }

  const paymentReference = paymentReferenceOf(parsed.data);
  if (!paymentReference) {
    throw new TranscriptValidationError(
      "missing_payment_reference",
      "Receipt is missing a payment reference (transaction hash or trace id)"
    );
  }

  if (parsed.data.providerId !== expectedProvider) {
    throw new TranscriptValidationError(
      "mismatched_provider",
      `Receipt provider "${parsed.data.providerId}" does not match expected "${expectedProvider}"`
    );
  }

  return parsed.data;
}

/** Public-safe one-line JSON payload — shared receipt fields only. */
export function formatReceiptTranscriptLine(receipt: Query402Receipt): string {
  const line = {
    schema: receipt.schema,
    generatedAt: receipt.generatedAt,
    mode: receipt.mode,
    providerId: receipt.providerId,
    providerName: receipt.providerName,
    quotedPriceUsd: receipt.quotedPriceUsd,
    traceId: receipt.traceId,
    resultTimestamp: receipt.resultTimestamp,
    paymentReference: paymentReferenceOf(receipt),
    payment: {
      mode: receipt.payment.mode,
      status: receipt.payment.status,
      evidenceKind: receipt.payment.evidenceKind,
      transactionHash: receipt.payment.transactionHash,
      network: receipt.payment.network
    }
  };
  const serialized = JSON.stringify(line);
  assertNoRawPaymentHeader(serialized);
  return serialized;
}

function assertNoRawPaymentHeader(serialized: string): void {
  const parsed = JSON.parse(serialized) as unknown;
  walkForRawPaymentHeaders(parsed);
}

function walkForRawPaymentHeaders(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) walkForRawPaymentHeaders(item);
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[-\s]/g, "");
    if (
      RAW_PAYMENT_HEADER_KEYS.has(key.toLowerCase()) ||
      RAW_PAYMENT_HEADER_KEYS.has(normalized)
    ) {
      throw new TranscriptValidationError(
        "invalid_schema",
        `Refusing to write raw payment header field "${key}" into the transcript`
      );
    }
    walkForRawPaymentHeaders(child);
  }
}

/**
 * Append one validated receipt line to a transcript file.
 * On validation failure the file is left unchanged and an error is thrown.
 */
export function appendReceiptToTranscript(
  transcriptPath: string,
  receipt: unknown,
  expectedProvider: string
): string {
  const valid = validateReceiptForTranscript(receipt, expectedProvider);
  const line = formatReceiptTranscriptLine(valid);

  const dir = path.dirname(transcriptPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.appendFileSync(transcriptPath, `${line}\n`, "utf8");
  return line;
}

function readArg(flag: string, args: string[]): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function hasFlag(flag: string, args: string[]): boolean {
  return args.includes(flag);
}

/**
 * CLI path: validate a receipt JSON file and append one line, or exit non-zero
 * without modifying the transcript.
 */
export function runAppendReceiptCli(argv: string[]): void {
  const receiptPath = readArg("--append-receipt", argv);
  const expectedProvider = readArg("--provider", argv);
  const transcriptPath =
    readArg("--transcript", argv) ?? DEFAULT_AGENT_RECEIPT_TRANSCRIPT;

  if (!receiptPath) {
    console.error("Missing --append-receipt <path-to-receipt.json>");
    process.exit(1);
  }
  if (!expectedProvider) {
    console.error("Missing --provider <providerId>");
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch (err) {
    console.error(
      `Failed to read receipt JSON: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }

  try {
    const line = appendReceiptToTranscript(transcriptPath, raw, expectedProvider);
    console.log(`Appended receipt line to ${transcriptPath}`);
    console.log(line);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Transcript append failed: ${message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Secret redaction (demo artifact generator)
// ---------------------------------------------------------------------------
const SECRET_PATTERNS: RegExp[] = [
  /S[A-Z0-9]{55}/g,
  /Bearer\s+\S+/gi,
  /x-payment:\s*\S+/gi,
  /X402-Payment:\s*\S+/gi
];
const REDACTED = "[REDACTED]";

const SENSITIVE_HEADER_KEYS = new Set([
  "x-payment",
  "x402-payment",
  "authorization",
  "x-api-key",
  "payment-response"
]);

const SENSITIVE_OBJ_KEYS = new Set([
  "secret",
  "secret_key",
  "secretkey",
  "private_key",
  "privatekey",
  "api_key",
  "apikey"
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
    http
      .get(url, (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
        res.on("end", () => {
          let body: unknown;
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      })
      .on("error", reject);
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

function buildReceiptFromPaidQuery(
  q: Parameters<typeof runPaidQuery>[0],
  response: Awaited<ReturnType<typeof runPaidQuery>>
): unknown {
  const payload = response.body as Record<string, unknown> | undefined;
  const result = payload?.result as Record<string, unknown> | undefined;
  const payment = payload?.payment as Record<string, unknown> | undefined;
  const evidence = payment?.evidence as Record<string, unknown> | undefined;

  const status = evidence?.status;
  const kind = evidence?.kind;
  const normalizedStatus =
    status === "verified" ||
    status === "settled" ||
    status === "failed" ||
    status === "demo-paid"
      ? status
      : response.isDemoMode
        ? "demo-paid"
        : null;
  const normalizedKind =
    kind === "demo" || kind === "verified" || kind === "settled" || kind === "failed"
      ? kind
      : response.isDemoMode
        ? "demo"
        : null;

  return {
    schema: RECEIPT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: q.mode,
    providerId: (result?.providerId as string | undefined) ?? q.provider,
    providerName: (result?.providerName as string | undefined) ?? q.provider,
    quotedPriceUsd: Number(result?.priceUsd ?? 0),
    traceId: String(result?.traceId ?? ""),
    resultTimestamp: String(result?.timestamp ?? new Date().toISOString()),
    payment: {
      mode: response.isDemoMode ? "demo" : "wallet",
      status: normalizedStatus,
      evidenceKind: normalizedKind,
      transactionHash: (evidence?.transactionHash as string | null | undefined) ?? null,
      network:
        (evidence?.network as string | null | undefined) ??
        (payment?.network as string | null | undefined) ??
        "stellar:testnet"
    }
  };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function step1Health(apiBase: string): Promise<Step> {
  const timestamp = new Date().toISOString();
  try {
    const r = await httpGet(`${apiBase}/health`);
    return {
      step: "1_health_check",
      timestamp,
      status: r.status,
      responseHeaders: safeHeaders(r.headers),
      body: redact(r.body),
      note:
        r.status === 200 ? "API is healthy and ready." : "API responded but may not be fully ready."
    };
  } catch (err) {
    return {
      step: "1_health_check",
      timestamp,
      status: "n/a",
      error: `Could not reach ${apiBase}/health — is the API running? (${err})`,
      note: "Transcript is still written for CI evidence purposes."
    };
  }
}

async function step2Catalog(apiBase: string): Promise<Step> {
  const timestamp = new Date().toISOString();
  try {
    const r = await httpGet(`${apiBase}/api/catalog`);
    return {
      step: "2_provider_catalog",
      timestamp,
      status: r.status,
      responseHeaders: safeHeaders(r.headers),
      body: redact(r.body),
      note: "Available search/news/scrape providers with per-request pricing."
    };
  } catch (err) {
    return {
      step: "2_provider_catalog",
      timestamp,
      status: "n/a",
      error: String(err)
    };
  }
}

/**
 * Runs the same three paid queries as demo.ts via the shared runPaidQuery
 * client — no duplication of payment logic.
 * Schema-valid receipts are appended to the agent receipt transcript; an
 * invalid receipt fails the command without writing that line.
 */
async function step3PaidQueries(receiptTranscriptPath: string): Promise<Step[]> {
  const queries: Array<Parameters<typeof runPaidQuery>[0]> = [
    {
      mode: "search",
      provider: "search.pro",
      query: "latest stellar x402 updates"
    },
    { mode: "news", provider: "news.deep", query: "stablecoin micropayments" },
    {
      mode: "scrape",
      provider: "scrape.extract",
      url: "https://developers.stellar.org"
    }
  ];

  const steps: Step[] = [];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const timestamp = new Date().toISOString();
    const label = `3${String.fromCharCode(97 + i)}_demo_paid_${q.mode}`;

    try {
      const response = await runPaidQuery(q);
      const payload = response.body as Record<string, unknown> | undefined;
      const result = payload?.result as Record<string, unknown> | undefined;

      if (response.ok) {
        const receipt = buildReceiptFromPaidQuery(q, response);
        // Fail closed: invalid receipts must not append a line.
        appendReceiptToTranscript(receiptTranscriptPath, receipt, q.provider);
      }

      steps.push({
        step: label,
        timestamp,
        status: response.status,
        body: redact({
          provider: q.provider,
          endpoint: response.endpoint,
          payment_response_present: Boolean(response.paymentResponse),
          price_usd: result?.priceUsd ?? "n/a",
          items_returned: Array.isArray(result?.items) ? result.items.length : 0,
          result_body: payload
        }),
        note:
          "DEMO_MODE=true — payment header contains a placeholder tx ID; " +
          "no real Stellar transaction is submitted or settled."
      });
    } catch (err) {
      if (err instanceof TranscriptValidationError) {
        throw err;
      }
      steps.push({ step: label, timestamp, status: "n/a", error: String(err) });
    }
  }

  return steps;
}

function step4Metadata(paidSteps: Step[]): Step {
  const first = paidSteps.find((s) => s.status !== "n/a");
  const body = first?.body as Record<string, unknown> | undefined;
  return {
    step: "4_response_metadata",
    timestamp: new Date().toISOString(),
    status: "n/a",
    body: {
      provider: body?.provider ?? "search.pro",
      price_usd: body?.price_usd ?? "n/a",
      settlement_network: "stellar:testnet",
      payment_status: "DEMO — no real Stellar settlement",
      note:
        "In production this section contains the facilitator-signed " +
        "payment-response header. Here it is intentionally omitted."
    },
    note: "Synthesised from paid-query responses. No secrets included."
  };
}

async function step5Analytics(apiBase: string): Promise<Step> {
  const timestamp = new Date().toISOString();
  try {
    const r = await httpGet(`${apiBase}/api/analytics`);
    return {
      step: "5_analytics_summary",
      timestamp,
      status: r.status,
      responseHeaders: safeHeaders(r.headers),
      body: redact(r.body),
      note: "Total spend + per-category breakdown stored in SQLite."
    };
  } catch (err) {
    return {
      step: "5_analytics_summary",
      timestamp,
      status: "n/a",
      error: String(err)
    };
  }
}

// ---------------------------------------------------------------------------
// Assemble + write artifact
// ---------------------------------------------------------------------------
function assemble(steps: Step[], apiBase: string): Transcript {
  return {
    label: "DEMO_MODE",
    demo_mode: true,
    generated_at: new Date().toISOString(),
    api_base: apiBase,
    settlement_network: "stellar:testnet",
    warning:
      "Generated in DEMO_MODE. No real Stellar credentials or live payments " +
      "were used. All secret fields are redacted. " +
      "Safe to attach to Drips/SCF updates and investor notes.",
    steps
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
    ""
  ];
  for (const s of t.steps) {
    lines.push(`▶ ${s.step}`);
    lines.push(`  Timestamp : ${s.timestamp}`);
    lines.push(`  Status    : ${s.status}`);
    if (s.note) lines.push(`  Note      : ${s.note}`);
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
  const txtPath = path.join(OUT_DIR, `demo-transcript-${slug}.txt`);

  fs.writeFileSync(jsonPath, JSON.stringify(t, null, 2), "utf8");
  fs.writeFileSync(txtPath, toText(t), "utf8");
  return { json: jsonPath, txt: txtPath };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (hasFlag("--append-receipt", args)) {
    runAppendReceiptCli(args);
    return;
  }

  if (config.DEMO_MODE !== "true") {
    console.error("ERROR: Set DEMO_MODE=true to generate a transcript without live credentials.");
    process.exit(1);
  }

  const apiBase = config.API_BASE_URL.replace(/\/$/, "");
  const receiptTranscriptPath = DEFAULT_AGENT_RECEIPT_TRANSCRIPT;

  console.log("▶ Query402 transcript generator  [DEMO_MODE=true]");
  console.log(`  API: ${apiBase}`);
  console.log("");

  const allSteps: Step[] = [];

  console.log("  [1/5] Health check…");
  allSteps.push(await step1Health(apiBase));

  console.log("  [2/5] Provider catalog…");
  allSteps.push(await step2Catalog(apiBase));

  console.log("  [3/5] Demo paid requests (search / news / scrape)…");
  const paidSteps = await step3PaidQueries(receiptTranscriptPath);
  allSteps.push(...paidSteps);

  console.log("  [4/5] Response metadata…");
  allSteps.push(step4Metadata(paidSteps));

  console.log("  [5/5] Analytics summary…");
  allSteps.push(await step5Analytics(apiBase));

  const transcript = assemble(allSteps, apiBase);
  const { json, txt } = writeArtifact(transcript);

  console.log("");
  console.log("✅ Transcript written:");
  console.log(`   JSON : ${json}`);
  console.log(`   TXT  : ${txt}`);
  console.log(`   Receipts JSONL : ${receiptTranscriptPath}`);
  console.log("");
  const note = "   Label   : DEMO_MODE  (safe for SCF / Drips / investor notes)";
  console.log(note);
  console.log("   Secrets : all redacted");
  console.log("   Payment : no real Stellar transaction");
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((err) => {
    console.error("Fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
