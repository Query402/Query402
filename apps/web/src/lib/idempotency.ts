import { normalizeQueryUrl } from "@query402/shared";
import type { QueryMode } from "@query402/shared";

const idempotencyKeys = new Map<string, string>();

export interface PaidRequestKeyInput {
  /** Route path of the paid endpoint, e.g. "/x402/search" or "/api/paid/run". */
  route: string;
  mode: QueryMode;
  provider: string;
  /** Search/news query text. Required unless mode is "scrape". */
  query?: string;
  /** Scrape target URL. Required when mode is "scrape". */
  url?: string;
  /**
   * Stable reference for the payment backing this request: the payer wallet
   * address (x402) or the sponsorship grant nonce (sponsored). Binds the key
   * to the payment so a different payment never reuses a previous key.
   */
  paymentReference: string;
}

function normalizeQueryInput(mode: QueryMode, query?: string, url?: string) {
  if (mode === "scrape") {
    if (!url) {
      throw new Error("url is required for scrape mode");
    }
    return { url: normalizeQueryUrl(url) };
  }

  if (!query) {
    throw new Error("query is required for search/news mode");
  }
  return { q: query.trim() };
}

/**
 * Canonical request identity for a paid web request.
 *
 * Mirrors the server-side fingerprint shape (see
 * `packages/shared/src/idempotency.ts`): route + mode + provider + normalized
 * query input + payment reference. Equivalent inputs therefore produce the
 * same identity (safe retries reuse the key) while any different query,
 * provider, or payment produces a different one.
 */
export function buildPaidRequestKey(input: PaidRequestKeyInput): string {
  return JSON.stringify({
    route: input.route,
    mode: input.mode,
    provider: input.provider,
    input: normalizeQueryInput(input.mode, input.query, input.url),
    paymentReference: input.paymentReference
  });
}

/**
 * Stable per-logical-request idempotency key: the same request identity always
 * maps to the same key, so safe retries deduplicate server-side.
 */
export function getIdempotencyKey(requestKey: string): string {
  const existing = idempotencyKeys.get(requestKey);
  if (existing) {
    return existing;
  }

  const key = crypto.randomUUID();
  idempotencyKeys.set(requestKey, key);
  return key;
}

/**
 * Test-only: clear the request-key -> idempotency-key mapping so tests start
 * from a clean slate without leaking keys between cases.
 */
export function resetIdempotencyKeysForTest(): void {
  idempotencyKeys.clear();
}
