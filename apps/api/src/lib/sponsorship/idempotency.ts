import { createHash } from "node:crypto";
import type { SignedGrant } from "@query402/shared";
import {
  acquireIdempotencyLock,
  cacheIdempotencyResponse,
  getCachedIdempotencyResponse,
  releaseIdempotencyLock
} from "../idempotency/service.js";

/**
 * Sponsorship grant issuance must be idempotent per client-supplied key: a
 * replay with the same key and body returns the ORIGINAL grant (no second
 * budget debit), while the same key with a different body is rejected.
 *
 * The stored request hash covers payer, amount and query so any body change
 * conflicts. For `Idempotency-Key` semantics on the paid-run route, the
 * shared fingerprint hash already does this; this module adds the same
 * guarantee to the grant endpoint, whose replay unit is the signed grant
 * itself.
 */

export interface SponsorshipIdempotencyInput {
  key: string;
  wallet: string;
  /** Quoted amount in USD the grant would cover. */
  amountUsd: number;
  /** Query (or URL) the sponsored run targets. Optional for grant-only flows. */
  query?: string;
}

export type SponsorshipIdempotencyResult =
  | { action: "acquire" }
  | { action: "replay"; signedGrant: SignedGrant }
  | { action: "in_progress" }
  | { action: "conflict" };

export function buildSponsorshipRequestHash(input: SponsorshipIdempotencyInput): string {
  // Normalize the amount to 6 decimals so float jitter cannot create a
  // false conflict, and bind the hash to the payer + query + purpose.
  const amount = input.amountUsd.toFixed(6);
  return createHash("sha256")
    .update(["sponsorship-grant", input.wallet, amount, input.query ?? ""].join("\n"))
    .digest("hex");
}

/**
 * Look up a previous grant for this key. Returns "replay" with the stored
 * grant when the same key+body is retried after completion, "conflict" when
 * the key was used with a different body, "in_progress" while another request
 * holds the lock, and "acquire" when this caller may issue a fresh grant.
 */
export function beginSponsorshipIdempotency(
  input: SponsorshipIdempotencyInput
): SponsorshipIdempotencyResult {
  const requestHash = buildSponsorshipRequestHash(input);

  const cached = getCachedIdempotencyResponse(input.key, requestHash);
  if (cached.hit) {
    return { action: "replay", signedGrant: cached.body as SignedGrant };
  }

  if (cached.conflict) {
    return { action: "conflict" };
  }

  const acquired = acquireIdempotencyLock(input.key, requestHash);
  if (acquired.state === "cached") {
    return { action: "replay", signedGrant: acquired.body as SignedGrant };
  }

  if (acquired.state === "conflict") {
    return { action: "conflict" };
  }

  if (acquired.state === "in_progress") {
    return { action: "in_progress" };
  }

  return { action: "acquire" };
}

/** Persist the issued grant so later replays return it unchanged. */
export function completeSponsorshipIdempotency(
  input: SponsorshipIdempotencyInput,
  signedGrant: SignedGrant
): void {
  cacheIdempotencyResponse(input.key, buildSponsorshipRequestHash(input), 200, signedGrant);
}

/** Release an in-flight lock after a failed issuance attempt. */
export function abortSponsorshipIdempotency(input: SponsorshipIdempotencyInput): void {
  releaseIdempotencyLock(input.key);
}
