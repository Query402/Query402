import type { Query402Receipt, QueryMode } from "@query402/shared";
import {
  query402ReceiptSchema,
  DEFAULT_TIMESTAMP_MAX_AGE_MS,
  isFreshTimestamp,
  isExpiredTimestamp
} from "@query402/shared";
import type { PaidQueryResponse, PublicPaymentEvidence } from "../types.js";

/**
 * User-selected payment mode. `"demo"` is inferred from the receipt itself
 * (the API stamped the response with `evidence.kind === "demo"`).
 */
export type ReceiptPaymentMode = "wallet" | "sponsored" | "demo";

const RECEIPT_SCHEMA = "query402.receipt.v1" as const;

export interface BuildReceiptInput {
  /** Successful API response from one paid demo/query run. */
  response: PaidQueryResponse;
  /** User-selected payment mode at the moment the query ran. */
  userPaymentMode: "wallet" | "sponsored";
  /** Optional override for the generation timestamp (used by tests). */
  generatedAt?: Date;
  /** Optional clock override for freshness checks (used by tests). */
  now?: Date | number;
}

function normalizeStatus(
  status: string | undefined
): "verified" | "settled" | "failed" | "demo-paid" | null {
  switch (status) {
    case "verified":
    case "settled":
    case "failed":
    case "demo-paid":
      return status;
    default:
      // Includes the `"settlement-pending"` interim status the API can produce
      // before any settlement confirmation; we surface it as `null` rather than
      // expose an internal-only state.
      return null;
  }
}

function normalizeKind(
  kind: PaymentEvidenceKind | undefined
): "demo" | "verified" | "settled" | "failed" | null {
  switch (kind) {
    case "demo":
    case "verified":
    case "settled":
    case "failed":
      return kind;
    default:
      return null;
  }
}

type PaymentEvidenceKind = PublicPaymentEvidence["kind"];

/**
 * Build a public, paste-into-a-public-SCF-issue JSON receipt from the latest
 * paid query response. NEVER include:
 *  - full base64 payment headers (would leak the signed payment payload),
 *  - facilitator responses (could leak signed auth entries),
 *  - facilitator API keys, raw wallet secrets, or grant signatures,
 *  - sponsorship grant or challenge responses,
 *  - the payer wallet address (public on-chain, but never paste-able by design).
 *
 * Missing payment fields render as `null` here so the JSON stays diff-friendly
 * in code review and SCF issue threads.
 */
export function buildReceipt(input: BuildReceiptInput): Query402Receipt {
  const { response, userPaymentMode } = input;
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const evidence: PublicPaymentEvidence | undefined = response.payment?.evidence;
  const kind = normalizeKind(evidence?.kind);
  const status = normalizeStatus(evidence?.status);
  const transactionHash = evidence?.transactionHash ?? null;
  const network = evidence?.network ?? response.payment?.network ?? null;
  const paymentMode: ReceiptPaymentMode = kind === "demo" ? "demo" : userPaymentMode;
  const now = input.now ?? new Date();
  const proofTimestamp = response.result.timestamp;
  const expired = isExpiredTimestamp(proofTimestamp, now);
  const paidStatus = expired ? null : status;

  return {
    schema: RECEIPT_SCHEMA,
    generatedAt,
    mode: response.result.mode satisfies QueryMode,
    providerId: response.result.providerId,
    providerName: response.result.providerName,
    quotedPriceUsd: response.result.priceUsd,
    traceId: response.result.traceId,
    resultTimestamp: response.result.timestamp,
    payment: {
      mode: paymentMode,
      status: paidStatus,
      evidenceKind: kind,
      transactionHash,
      network
    }
  };
}

/**
 * Serialize a receipt to a stable, human-readable JSON string. Stable key
 * ordering means repeated exports diff cleanly in code review.
 */
export function serializeReceipt(receipt: Query402Receipt): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

/**
 * Build a safe filename for the downloaded JSON receipt. Avoids leaking
 * provider ids into the path beyond a short slug.
 */
export function receiptFilename(receipt: Query402Receipt, generatedAt?: Date): string {
  const stamp = (generatedAt ?? new Date(receipt.generatedAt)).toISOString().replace(/[:.]/g, "-");
  const providerSlug = receipt.providerId.replace(/[^a-z0-9_.-]/gi, "_");
  return `query402-receipt-${receipt.mode}-${providerSlug}-${stamp}.json`;
}

export interface CopyReceiptResult {
  ok: boolean;
  method: "clipboard" | "fallback";
  bytes: number;
}

/**
 * Copy the receipt to the clipboard with a download fallback. The fallback
 * triggers automatically when the Clipboard API is unavailable (older
 * browsers, restrictive iframes, missing permissions).
 */
export async function copyReceiptToClipboard(receipt: Query402Receipt): Promise<CopyReceiptResult> {
  const json = serializeReceipt(receipt);
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(json);
      return { ok: true, method: "clipboard", bytes: json.length };
    } catch {
      // fall through to download fallback
    }
  }
  downloadReceipt(receipt, json);
  return { ok: true, method: "fallback", bytes: json.length };
}

/**
 * Trigger a JSON file download for the receipt. SSR/no-DOM callers can no-op
 * via `typeof document === "undefined" `.
 */
export function downloadReceipt(
  receipt: Query402Receipt,
  payload?: string,
  generatedAt?: Date
): void {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof Blob === "undefined"
  ) {
    return;
  }
  const json = payload ?? serializeReceipt(receipt);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = receiptFilename(receipt, generatedAt);
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Validate an unknown value as a Query402 receipt. Invalid shapes return null
 * rather than throwing so UI callers can hide the paid banner cleanly.
 */
export function validateReceipt(input: unknown): Query402Receipt | null {
  const parsed = query402ReceiptSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/**
 * A receipt is current when its `generatedAt` passes the shared freshness
 * helper. The proof timestamp is the receipt generation time — not the older
 * result timestamp — so an otherwise-valid export is not hidden solely because
 * the underlying query finished earlier in the freshness window.
 */
export function isReceiptProofFresh(
  receipt: Query402Receipt,
  now: Date | number = Date.now(),
  maxAgeMs = DEFAULT_TIMESTAMP_MAX_AGE_MS
): boolean {
  return isFreshTimestamp(receipt.generatedAt, now, maxAgeMs);
}

export type PaymentEvidenceGate = {
  show: boolean;
  reason: "ok" | "invalid_receipt" | "stale_receipt" | "missing_receipt";
  receipt: Query402Receipt | null;
};

/**
 * Gate for the payment evidence banner: the receipt must validate and the
 * shared freshness check must say the proof is still current.
 */
export function evaluatePaymentEvidenceGate(
  input: unknown,
  now: Date | number = Date.now(),
  maxAgeMs = DEFAULT_TIMESTAMP_MAX_AGE_MS
): PaymentEvidenceGate {
  if (input === null || input === undefined) {
    return { show: false, reason: "missing_receipt", receipt: null };
  }

  const receipt = validateReceipt(input);
  if (!receipt) {
    return { show: false, reason: "invalid_receipt", receipt: null };
  }

  if (!isReceiptProofFresh(receipt, now, maxAgeMs)) {
    return { show: false, reason: "stale_receipt", receipt };
  }

  return { show: true, reason: "ok", receipt };
}
