import type { Request } from "express";
import { INVALID_IDEMPOTENCY_KEY_ERROR, MAX_IDEMPOTENCY_KEY_LENGTH } from "@query402/shared";

/** Stable 400 response for every invalid `Idempotency-Key` shape. */
export const INVALID_IDEMPOTENCY_KEY_BODY = {
  error: "Invalid Idempotency-Key header",
  type: INVALID_IDEMPOTENCY_KEY_ERROR,
  errorCode: INVALID_IDEMPOTENCY_KEY_ERROR
} as const;

export type IdempotencyKeyValidation =
  { valid: true; key: string | undefined } | { valid: false; key: undefined };

/**
 * Read the raw header occurrences so repeated `Idempotency-Key` headers cannot
 * hide behind Express' comma-joined `req.get()` value.
 */
function idempotencyKeyHeaderValues(req: Request): string[] {
  const values: string[] = [];
  const rawHeaders = req.rawHeaders ?? [];

  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === "idempotency-key") {
      values.push(rawHeaders[index + 1] ?? "");
    }
  }

  // Non-Node-compatible request adapters may not expose rawHeaders.
  if (values.length === 0) {
    const value = req.get("Idempotency-Key");
    if (value !== undefined) {
      values.push(value);
    }
  }

  return values;
}

/**
 * Validate before any idempotency storage lookup/write, payment settlement, or
 * provider execution. An absent header is allowed (retries are not deduped);
 * a present header must be exactly one non-empty, bounded value.
 */
export function validateIdempotencyKey(req: Request): IdempotencyKeyValidation {
  const values = idempotencyKeyHeaderValues(req);
  if (values.length === 0) {
    return { valid: true, key: undefined };
  }

  if (values.length !== 1) {
    return { valid: false, key: undefined };
  }

  const key = values[0].trim();
  if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return { valid: false, key: undefined };
  }

  return { valid: true, key };
}
