import type { QueryMode } from "@query402/shared";
import type { HealthResponse } from "../types.js";
import { buildPaidRequestKey, getIdempotencyKey } from "./idempotency.js";

// Optional chain keeps this module importable outside Vite (node:test).
export const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL ?? "http://localhost:3001";

/**
 * Route prefixes that are paid/protected: the x402 wallet routes and the
 * sponsored paid-run route. Payment material and paid-request idempotency
 * keys are only ever sent here — never on public routes.
 */
const PAID_PROTECTED_ROUTE_PREFIXES = ["/x402/", "/api/paid/"];

/**
 * Header names that carry payment material, plus the paid-request idempotency
 * key (it is derived from the payment reference, so it is payment-bound too).
 * None of these may be sent to a public path.
 */
const PAYMENT_HEADER_NAMES = [
  "payment",
  "x-payment",
  "x402-payment",
  "payment-response",
  "x-payment-response",
  "x-sponsorship-grant",
  "idempotency-key"
] as const;

/** Reduce an absolute URL or path to its route path (no query/hash). */
export function requestRoute(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl).pathname;
  } catch {
    return pathOrUrl.split(/[?#]/, 1)[0];
  }
}

export function isPaidProtectedPath(pathOrUrl: string): boolean {
  const route = requestRoute(pathOrUrl);
  return PAID_PROTECTED_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix));
}

/**
 * Refuse to dispatch a request that would leak payment material to a public
 * path. Payment headers (and the payment-bound idempotency key) belong on
 * protected paid routes only.
 */
export function assertNoPaymentHeaders(requestUrl: string, headers?: HeadersInit): void {
  if (!headers || isPaidProtectedPath(requestUrl)) {
    return;
  }

  const outgoing = new Headers(headers);
  for (const name of PAYMENT_HEADER_NAMES) {
    if (outgoing.has(name)) {
      throw new Error(
        `Refusing to send payment header "${name}" to public path "${requestRoute(requestUrl)}".`
      );
    }
  }
}

export interface PaidQueryHeaderInput {
  /** Absolute URL or path the request will be sent to. */
  requestUrl: string;
  mode: QueryMode;
  provider: string;
  /** Search/news query text. Required unless mode is "scrape". */
  query?: string;
  /** Scrape target URL. Required when mode is "scrape". */
  url?: string;
  /**
   * Stable reference for the payment backing this request: the payer wallet
   * address (x402) or the sponsorship grant nonce (sponsored).
   */
  paymentReference: string;
}

/**
 * Headers for a paid request: exactly one Idempotency-Key derived from the
 * provider, the query, and the payment reference. Throws when the target is
 * not a protected paid route — a key is never issued for a public path.
 */
export function paidQueryHeaders(input: PaidQueryHeaderInput): Record<string, string> {
  const route = requestRoute(input.requestUrl);
  if (!isPaidProtectedPath(route)) {
    throw new Error(`Refusing to attach a paid idempotency key to non-protected path "${route}".`);
  }

  const requestKey = buildPaidRequestKey({
    route,
    mode: input.mode,
    provider: input.provider,
    query: input.query,
    url: input.url,
    paymentReference: input.paymentReference
  });

  return { "Idempotency-Key": getIdempotencyKey(requestKey) };
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  assertNoPaymentHeaders(url, init?.headers);
  const response = await fetch(url, init);
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const payload = await response.json();
      if (typeof payload?.error === "string" && payload.error.length > 0) {
        throw new Error(payload.error);
      }
      if (typeof payload?.message === "string" && payload.message.length > 0) {
        throw new Error(payload.message);
      }
      throw new Error(JSON.stringify(payload));
    }

    const textMessage = await response.text();
    throw new Error(textMessage || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchHealth(apiBaseUrl: string): Promise<HealthResponse> {
  return fetchJson<HealthResponse>(`${apiBaseUrl}/health`);
}

export function money(value: number) {
  return `$${value.toFixed(3)}`;
}
