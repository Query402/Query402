import type { QueryMode } from "./types.js";

export interface PaidRequestFingerprintInput {
  method: "GET" | "POST";
  route: string;
  mode: QueryMode;
  provider: string;
  query?: string;
  url?: string;
  payer: string;
  network: string;
  quotedAmountUsd: number;
}

export interface PaidRequestFingerprint {
  method: "GET" | "POST";
  route: string;
  provider: string;
  input: {
    q?: string;
    url?: string;
  };
  payer: string;
  network: string;
  quotedAmountUsd: number;
}

/**
 * Normalize a scrape-mode query URL so cache/idempotency lookups treat
 * equivalent URLs as the same request.
 *
 * Normalizes:
 * - Scheme and host casing (`HTTPS://Example.COM` -> `https://example.com`)
 *   -- handled automatically by the WHATWG `URL` parser, which lowercases
 *   both per RFC 3986.
 * - A trailing slash (or run of trailing slashes) on the path, except for
 *   the root path itself (`/` is never stripped down to empty).
 *
 * Deliberately preserves:
 * - Query string semantics -- parameter names, values, and order are left
 *   completely untouched. Query strings can be case-sensitive and
 *   order-sensitive server-side, so this never reorders, re-cases, or
 *   re-encodes them.
 * - Path segment casing beyond the trailing slash -- paths are
 *   case-sensitive per spec (server-dependent), so `/Foo` and `/foo`
 *   remain distinct.
 * - The fragment, port, and everything else in the URL.
 *
 * Input that isn't a parseable absolute URL is returned trimmed but
 * otherwise unchanged -- this mirrors the previous behavior for
 * non-normalizable input rather than throwing from a cache-key helper.
 */
export function normalizeQueryUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  // Scheme and host are already lowercased by the URL parser itself.
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  }

  return parsed.toString();
}

function normalizeQueryInput(mode: QueryMode, query?: string, url?: string) {
  if (mode === "scrape") {
    return { url: url === undefined ? undefined : normalizeQueryUrl(url) };
  }

  return { q: query?.trim() };
}

export function buildPaidRequestFingerprint(
  input: PaidRequestFingerprintInput
): PaidRequestFingerprint {
  return {
    method: input.method,
    route: input.route,
    provider: input.provider,
    input: normalizeQueryInput(input.mode, input.query, input.url),
    payer: input.payer,
    network: input.network,
    quotedAmountUsd: Number(input.quotedAmountUsd.toFixed(6))
  };
}

export function hashPaidRequestFingerprint(fingerprint: PaidRequestFingerprint): string {
  return JSON.stringify(fingerprint);
}
