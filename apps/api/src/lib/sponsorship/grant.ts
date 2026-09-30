import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SignedGrant, SponsorshipGrant } from "@query402/shared";
import { config } from "../config.js";
import { grantWithDebit } from "./budget.js";

function serializeGrant(grant: SponsorshipGrant): string {
  return [
    grant.grantId,
    grant.wallet,
    grant.network,
    grant.mode ?? "",
    grant.providerId ?? "",
    grant.maxAmountUsd.toString(),
    grant.expiresAt,
    grant.nonce,
    grant.issuedAt
  ].join("|");
}

function signPayload(payload: string): string {
  const secret = config.SPONSORSHIP_SIGNING_SECRET;
  if (!secret) {
    throw new Error("SPONSORSHIP_SIGNING_SECRET is not configured");
  }

  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signGrant(grant: SponsorshipGrant): SignedGrant {
  return {
    grant,
    signature: signPayload(serializeGrant(grant))
  };
}

export function verifyGrant(signed: SignedGrant): boolean {
  const secret = config.SPONSORSHIP_SIGNING_SECRET;
  if (!secret) {
    return false;
  }

  const expected = signPayload(serializeGrant(signed.grant));

  try {
    return timingSafeEqual(Buffer.from(signed.signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export interface IssueGrantInput {
  wallet: string;
  /** Amount the policy preview authorized. When provided, the grant debit is
   * applied in the same transaction as the grant write and must match the
   * grant's max amount. */
  previewAmountUsd?: number;
  /** Optional nonce override; defaults to a fresh UUID. */
  nonce?: string;
  /** Optional grant id override; defaults to a fresh UUID. */
  grantId?: string;
}

export function issueGrant(walletOrInput: string | IssueGrantInput): SignedGrant {
  const input: IssueGrantInput =
    typeof walletOrInput === "string" ? { wallet: walletOrInput } : walletOrInput;

  const now = new Date();
  const grant: SponsorshipGrant = {
    grantId: input.grantId ?? randomUUID(),
    wallet: input.wallet,
    network: config.STELLAR_NETWORK,
    maxAmountUsd: config.SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD,
    expiresAt: new Date(now.getTime() + config.SPONSORSHIP_GRANT_TTL_SECONDS * 1000).toISOString(),
    nonce: input.nonce ?? randomUUID(),
    issuedAt: now.toISOString()
  };

  if (input.previewAmountUsd !== undefined) {
    grantWithDebit({
      wallet: grant.wallet,
      amountUsd: grant.maxAmountUsd,
      nonce: grant.nonce,
      grantId: grant.grantId,
      previewAmountUsd: input.previewAmountUsd
    });
  }

  return signGrant(grant);
}
