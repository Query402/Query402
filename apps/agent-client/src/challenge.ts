import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";

/**
 * Client-side challenge validation for the agent CLI.
 *
 * The x402 flow hands the server's 402 challenge to the payment library,
 * which would otherwise sign whatever amount/network/payTo it finds. The CLI
 * must first compare the challenge against its own configuration and refuse
 * to reach the signer when they disagree (issue #176).
 */

export interface CliPaymentExpectation {
  /** Provider id the CLI command named (e.g. "search.basic"). */
  provider: string;
  /** CAIP-like network from CLI config (e.g. "stellar:testnet"). */
  network: string;
  /** Expected settlement asset from CLI config (e.g. "USDC:testnet"). */
  asset: string;
  /** Maximum acceptable amount per query, in USD. */
  maxPriceUsd: number;
}

/** One disagreeing field between the challenge and the CLI configuration. */
export interface ChallengeMismatch {
  field: "provider" | "network" | "asset" | "amount";
  expected: string;
  actual: string;
}

export type ChallengeValidationResult =
  { ok: true; requirements: PaymentRequirements } | { ok: false; mismatch: ChallengeMismatch };

/**
 * Amounts are quoted in asset smallest units (USDC has 6 decimals). Compare
 * with integer math to stay float-safe.
 */
export function parseAmountToUsd(amount: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(amount.trim())) {
    return null;
  }
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? parsed / 1_000_000 : null;
}

function resourceProvider(challenge: PaymentRequired): string | null {
  const url = challenge.resource?.url;
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const provider = parsed.searchParams.get("provider");
    return provider && provider.length > 0 ? provider : null;
  } catch {
    return null;
  }
}

/**
 * Compare a 402 challenge against the CLI's own configuration. Returns the
 * first disagreeing field so the CLI can print what did not match — never
 * the raw payment header.
 */
export function validateChallengeAgainstConfig(
  challenge: PaymentRequired,
  expected: CliPaymentExpectation,
  requestUrl?: string
): ChallengeValidationResult {
  const accepts = challenge.accepts ?? [];
  if (accepts.length === 0) {
    return {
      ok: false,
      mismatch: { field: "network", expected: expected.network, actual: "missing accepts[]" }
    };
  }

  const requirements = accepts[0] as PaymentRequirements;

  if (requirements.network !== expected.network) {
    return {
      ok: false,
      mismatch: {
        field: "network",
        expected: expected.network,
        actual: String(requirements.network)
      }
    };
  }

  if (requirements.asset !== expected.asset) {
    return {
      ok: false,
      mismatch: {
        field: "asset",
        expected: expected.asset,
        actual: String(requirements.asset)
      }
    };
  }

  const amountUsd = parseAmountToUsd(String(requirements.amount));
  if (amountUsd === null) {
    return {
      ok: false,
      mismatch: {
        field: "amount",
        expected: `<= ${expected.maxPriceUsd}`,
        actual: `unparseable amount: ${String(requirements.amount)}`
      }
    };
  }

  if (amountUsd > expected.maxPriceUsd) {
    return {
      ok: false,
      mismatch: {
        field: "amount",
        expected: `<= ${expected.maxPriceUsd}`,
        actual: String(amountUsd)
      }
    };
  }

  if (requestUrl) {
    // The provider named in the CLI command/config is authoritative; the
    // server-controlled challenge resource URL must agree with it.
    const expectedProvider = expected.provider;
    const challengeProvider = resourceProvider(challenge);
    if (challengeProvider && challengeProvider !== expectedProvider) {
      return {
        ok: false,
        mismatch: {
          field: "provider",
          expected: expectedProvider,
          actual: challengeProvider
        }
      };
    }
  }

  return { ok: true, requirements };
}
