import crypto from "node:crypto";
import type { PaymentAttempt, UsageEvent } from "@query402/shared";
import { isSensitiveHeader } from "./redact-headers.js";

/**
 * Hash a payer public key for privacy-safe display
 * Uses SHA256 to create a consistent hash that cannot be reversed
 */
export function hashPayerKey(payerPublicKey: string | undefined): string | undefined {
  if (!payerPublicKey) {
    return undefined;
  }
  return crypto.createHash("sha256").update(payerPublicKey).digest("hex").slice(0, 16);
}

/** Result of preparing an analytics record for durable storage. */
export type AnalyticsPrivacyResult<T> =
  | { ok: true; value: T }
  | { ok: false; cannotRedact: string[] };

/** Fields whose values are payment headers / payloads and must be dropped. */
const DROPPED_PAYMENT_HEADER_FIELDS = new Set([
  "payment",
  "paymentresponse",
  "paymentresponseheader",
  "paymentheader",
  "paymentsignature",
  "xpayment",
  "xpaymentresponse",
  "xpaymentsignature",
  "paymentpayload"
]);

/**
 * Known analytics fields that may be retained after redaction.
 * Extra sensitive fields outside this set are reported as cannot-redact.
 */
const ALLOWED_ANALYTICS_FIELDS = new Set([
  "id",
  "mode",
  "endpoint",
  "providerid",
  "queryorurl",
  "priceusd",
  "network",
  "paymentstatus",
  "paymentkind",
  "paymenttxhash",
  "asset",
  "paytoaddress",
  "amount",
  "amountusd",
  "facilitatorurl",
  "payerpublickey",
  "traceid",
  "paymentid",
  "createdat",
  "latencyms",
  "execution",
  "sponsorshipgrantid",
  "policydecision",
  "paymentsource",
  "sponsorpublickey",
  "priceoutlier",
  "priceoutlierreason",
  "errorcode",
  "error",
  "status",
  "transactionhash",
  "evidencekind",
  "facilitatorresult"
]);

/** URL-valued fields where userinfo must be stripped before storage. */
const URL_FIELDS = new Set(["facilitatorurl", "endpoint"]);

/** Extra keys that look secret-bearing and cannot be safely redacted. */
const UNREDACTABLE_SENSITIVE_TOKENS = [
  "secret",
  "privatekey",
  "apikey",
  "authorization",
  "rawpayload",
  "rawpayment",
  "signedpayload",
  "proof"
];

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/**
 * Remove userinfo (username/password) from a URL string.
 * Non-URL values are returned unchanged.
 */
export function stripUrlUserinfo(value: string): string {
  try {
    const parsed = new URL(value);
    if (!parsed.username && !parsed.password) {
      return value;
    }
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

/**
 * Coarsen an ISO timestamp to hour precision for analytics storage.
 */
export function toCoarseTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function isDroppedPaymentHeaderField(key: string): boolean {
  const normalized = normalizeKey(key);
  if (DROPPED_PAYMENT_HEADER_FIELDS.has(normalized)) {
    return true;
  }
  return isSensitiveHeader(key);
}

function looksUnredactable(key: string): boolean {
  const normalized = normalizeKey(key);
  if (ALLOWED_ANALYTICS_FIELDS.has(normalized)) {
    return false;
  }
  if (isDroppedPaymentHeaderField(key)) {
    return false;
  }
  return UNREDACTABLE_SENSITIVE_TOKENS.some(
    (token) => normalized === token || normalized.includes(token)
  );
}

function redactHeadersRecord(
  headers: Record<string, unknown>
): { headers: Record<string, unknown>; cannotRedact: string[] } {
  const next: Record<string, unknown> = {};
  const cannotRedact: string[] = [];

  for (const [key, value] of Object.entries(headers)) {
    if (isDroppedPaymentHeaderField(key)) {
      continue;
    }
    if (looksUnredactable(key)) {
      cannotRedact.push(`headers.${key}`);
      continue;
    }
    if (typeof value === "string") {
      next[key] = stripUrlUserinfo(value);
      continue;
    }
    if (value !== null && typeof value === "object") {
      cannotRedact.push(`headers.${key}`);
      continue;
    }
    next[key] = value;
  }

  return { headers: next, cannotRedact };
}

function sanitizeRecord<T extends object>(
  input: T & Record<string, unknown>,
  options: { dropQueryText: boolean }
): AnalyticsPrivacyResult<T> {
  const cannotRedact: string[] = [];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    const normalized = normalizeKey(key);

    if (options.dropQueryText && normalized === "queryorurl") {
      sanitized.queryOrUrl = "";
      continue;
    }

    if (normalized === "createdat" && typeof value === "string") {
      sanitized.createdAt = toCoarseTimestamp(value);
      continue;
    }

    if (normalized === "headers" && value && typeof value === "object" && !Array.isArray(value)) {
      const redacted = redactHeadersRecord(value as Record<string, unknown>);
      cannotRedact.push(...redacted.cannotRedact);
      if (Object.keys(redacted.headers).length > 0) {
        sanitized.headers = redacted.headers;
      }
      continue;
    }

    if (isDroppedPaymentHeaderField(key)) {
      continue;
    }

    if (looksUnredactable(key)) {
      cannotRedact.push(key);
      continue;
    }

    if (URL_FIELDS.has(normalized) && typeof value === "string") {
      sanitized[key] = stripUrlUserinfo(value);
      continue;
    }

    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      sanitized[key] = stripUrlUserinfo(value);
      continue;
    }

    sanitized[key] = value;
  }

  if (cannotRedact.length > 0) {
    return { ok: false, cannotRedact };
  }

  return { ok: true, value: sanitized as T };
}

/**
 * Prepare a usage event for analytics storage.
 * Drops query text and payment headers, strips URL userinfo, coarsens timestamp.
 * Rejects the write when a sensitive field cannot be redacted.
 */
export function sanitizeAnalyticsEventForStorage(
  event: UsageEvent | (UsageEvent & Record<string, unknown>)
): AnalyticsPrivacyResult<UsageEvent> {
  return sanitizeRecord(event as UsageEvent & Record<string, unknown>, {
    dropQueryText: true
  });
}

/**
 * Prepare a payment attempt for analytics storage.
 * Drops payment headers, strips URL userinfo, coarsens timestamp.
 */
export function sanitizePaymentAttemptForStorage(
  payment: PaymentAttempt | (PaymentAttempt & Record<string, unknown>)
): AnalyticsPrivacyResult<PaymentAttempt> {
  return sanitizeRecord(payment as PaymentAttempt & Record<string, unknown>, {
    dropQueryText: false
  });
}

/**
 * Check if a record is within the retention period
 */
export function isWithinRetention(createdAt: string, retentionDays: number): boolean {
  const created = new Date(createdAt);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return created >= cutoff;
}

/**
 * Encode cursor as base64
 */
export function encodeCursor(data: { timestamp: string; id: string }): string {
  const json = JSON.stringify(data);
  return Buffer.from(json).toString("base64");
}

/**
 * Decode cursor from base64
 */
export function decodeCursor(cursor: string): { timestamp: string; id: string } | null {
  try {
    const json = Buffer.from(cursor, "base64").toString("utf-8");
    const data = JSON.parse(json);
    if (data.timestamp && data.id) {
      return data;
    }
  } catch {
    // Invalid cursor
  }
  return null;
}

/**
 * Generate next cursor for pagination
 */
export function generateNextCursor(
  records: Array<{ createdAt: string; id: string }>
): string | undefined {
  if (records.length === 0) {
    return undefined;
  }
  const lastRecord = records[records.length - 1];
  return encodeCursor({
    timestamp: lastRecord.createdAt,
    id: lastRecord.id
  });
}
