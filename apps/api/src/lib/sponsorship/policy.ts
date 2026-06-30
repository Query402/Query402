import type { QueryMode, SignedGrant } from "@query402/shared";
import { signedGrantSchema } from "@query402/shared";
import { config } from "../config.js";
import { getProviderById } from "../pricing.js";
import { wouldExceedBudget } from "./budget.js";
import { getDailyWindowStart } from "./budget.js";
import { getSponsorshipDb } from "./store.js";
import { issueGrant, verifyGrant } from "./grant.js";
import { isSponsorshipStorageAvailable } from "./store.js";

export type PolicyDecision =
  | "allowed"
  | "denied_sponsorship_disabled"
  | "denied_storage_unavailable"
  | "denied_invalid_grant"
  | "denied_wrong_wallet"
  | "denied_wrong_network"
  | "denied_wrong_provider"
  | "denied_price_exceeded"
  | "denied_expired"
  | "denied_nonce_replay"
  | "denied_budget_exceeded";

export interface PolicyResult {
  allowed: boolean;
  statusCode: number;
  decision: PolicyDecision;
  error?: string;
  grantId?: string;
  quotedPriceUsd?: number;
}

export interface AuthorizeSponsoredRunInput {
  signedGrant: SignedGrant;
  wallet: string;
  mode: QueryMode;
  provider: string;
}

function deny(
  decision: PolicyDecision,
  statusCode: number,
  error: string,
  extra: Partial<PolicyResult> = {}
): PolicyResult {
  return {
    allowed: false,
    statusCode,
    decision,
    error,
    ...extra
  };
}

/** Re-export for route handlers. */
export { isSponsorshipStorageAvailable } from "./store.js";

function checkBudget(wallet: string, amountUsd: number, grantId: string): PolicyResult | null {
  try {
    const exceeded = wouldExceedBudget(wallet, amountUsd);

    if (exceeded) {
      return deny("denied_budget_exceeded", 429, `${exceeded}_budget_exceeded`, { grantId });
    }

    return null;
  } catch {
    return deny("denied_storage_unavailable", 503, "sponsorship_storage_unavailable");
  }
}

export function authorizeSponsoredRun(input: AuthorizeSponsoredRunInput): PolicyResult {
  if (!config.sponsorshipEnabled) {
    return deny("denied_sponsorship_disabled", 503, "sponsorship_disabled");
  }

  if (!isSponsorshipStorageAvailable()) {
    return deny("denied_storage_unavailable", 503, "sponsorship_storage_unavailable");
  }

  const parsedGrant = signedGrantSchema.safeParse(input.signedGrant);
  if (!parsedGrant.success || !verifyGrant(parsedGrant.data)) {
    return deny("denied_invalid_grant", 403, "invalid_grant");
  }

  const { grant } = parsedGrant.data;

  if (input.wallet !== grant.wallet) {
    return deny("denied_wrong_wallet", 403, "wrong_wallet", { grantId: grant.grantId });
  }

  if (grant.network !== config.STELLAR_NETWORK) {
    return deny("denied_wrong_network", 403, "wrong_network", { grantId: grant.grantId });
  }

  if (grant.mode && grant.mode !== input.mode) {
    return deny("denied_wrong_provider", 403, "wrong_mode", { grantId: grant.grantId });
  }

  if (grant.providerId && grant.providerId !== input.provider) {
    return deny("denied_wrong_provider", 403, "wrong_provider", { grantId: grant.grantId });
  }

  const provider = getProviderById(input.provider);
  if (!provider || provider.category !== input.mode) {
    return deny("denied_wrong_provider", 403, "unknown_provider", { grantId: grant.grantId });
  }

  if (provider.priceUsd > grant.maxAmountUsd) {
    return deny("denied_price_exceeded", 403, "price_exceeds_grant", {
      grantId: grant.grantId,
      quotedPriceUsd: provider.priceUsd
    });
  }

  if (new Date(grant.expiresAt).getTime() <= Date.now()) {
    return deny("denied_expired", 403, "grant_expired", { grantId: grant.grantId });
  }

  const budgetResult = checkBudget(grant.wallet, provider.priceUsd, grant.grantId);
  if (budgetResult) {
    return budgetResult;
  }

  return {
    allowed: true,
    statusCode: 200,
    decision: "allowed",
    grantId: grant.grantId,
    quotedPriceUsd: provider.priceUsd
  };
}

export interface PreviewSponsoredRunInput {
  wallet: string;
  mode: QueryMode;
  provider: string;
}

export interface PreviewBudget {
  limitUsd: number;
  spentUsd: number;
  remainingUsd: number;
  windowStart: string;
}

export interface PreviewRestrictions {
  mode: QueryMode | null;
  providerId: string | null;
}

export interface PreviewGrant {
  maxAmountUsd: number;
  ttlSeconds: number;
  expiresInSeconds: number;
  restrictions: PreviewRestrictions;
}

export interface PreviewResult {
  sponsorshipEnabled: boolean;
  storageAvailable: boolean;
  available: boolean;
  decision: string;
  network: string;
  wallet: string;
  mode: QueryMode;
  provider: string;
  providerName: string;
  grant: PreviewGrant;
  quotedPriceUsd: number;
  priceFitsGrant: boolean;
  perWalletBudget: PreviewBudget;
  globalBudget: PreviewBudget;
  reason?: string;
}

function readBudgetSpent(scope: "wallet" | "global", wallet: string | null): number {
  try {
    const database = getSponsorshipDb();
    const row = database
      .prepare(
        `SELECT spent_usd
         FROM sponsorship_budgets
         WHERE scope = ? AND wallet IS ? AND window_start = ?`
      )
      .get(scope, wallet, getDailyWindowStart()) as { spent_usd: number } | undefined;
    return row?.spent_usd ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Read-only policy preview for a sponsored run. Synthesizes a hypothetical
 * fresh grant using current config, then runs the exact same authorization
 * logic that authorizeSponsoredRun uses on a real grant. Does NOT consume
 * nonce or budget. Never returns a signature.
 */
export function previewSponsoredRun(input: PreviewSponsoredRunInput): PreviewResult {
  const sponsorshipEnabled = config.sponsorshipEnabled;
  const storageAvailable = isSponsorshipStorageAvailable();
  const windowStart = getDailyWindowStart();

  const provider = getProviderById(input.provider);
  const providerName = provider?.name ?? input.provider;
  const quotedPriceUsd = provider?.priceUsd ?? 0;
  const priceFitsGrant = provider
    ? quotedPriceUsd <= config.SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD
    : false;

  const walletSpent = readBudgetSpent("wallet", input.wallet);
  const globalSpent = readBudgetSpent("global", null);
  const perWalletBudget: PreviewBudget = {
    limitUsd: config.SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD,
    spentUsd: walletSpent,
    remainingUsd: Math.max(
      Number((config.SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD - walletSpent).toFixed(6)),
      0
    ),
    windowStart
  };
  const globalBudget: PreviewBudget = {
    limitUsd: config.SPONSORSHIP_GLOBAL_DAILY_BUDGET_USD,
    spentUsd: globalSpent,
    remainingUsd: Math.max(
      Number((config.SPONSORSHIP_GLOBAL_DAILY_BUDGET_USD - globalSpent).toFixed(6)),
      0
    ),
    windowStart
  };

  const restrictions: PreviewRestrictions = {
    mode: null,
    providerId: null
  };

  if (!sponsorshipEnabled) {
    return {
      sponsorshipEnabled,
      storageAvailable,
      available: false,
      decision: "denied_sponsorship_disabled",
      network: config.STELLAR_NETWORK,
      wallet: input.wallet,
      mode: input.mode,
      provider: input.provider,
      providerName,
      grant: {
        maxAmountUsd: config.SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD,
        ttlSeconds: config.SPONSORSHIP_GRANT_TTL_SECONDS,
        expiresInSeconds: config.SPONSORSHIP_GRANT_TTL_SECONDS,
        restrictions
      },
      quotedPriceUsd,
      priceFitsGrant,
      perWalletBudget,
      globalBudget,
      reason: "sponsorship_disabled"
    };
  }

  if (!storageAvailable) {
    return {
      sponsorshipEnabled,
      storageAvailable,
      available: false,
      decision: "denied_storage_unavailable",
      network: config.STELLAR_NETWORK,
      wallet: input.wallet,
      mode: input.mode,
      provider: input.provider,
      providerName,
      grant: {
        maxAmountUsd: config.SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD,
        ttlSeconds: config.SPONSORSHIP_GRANT_TTL_SECONDS,
        expiresInSeconds: config.SPONSORSHIP_GRANT_TTL_SECONDS,
        restrictions
      },
      quotedPriceUsd,
      priceFitsGrant,
      perWalletBudget,
      globalBudget,
      reason: "sponsorship_storage_unavailable"
    };
  }

  if (!provider || provider.category !== input.mode) {
    return {
      sponsorshipEnabled,
      storageAvailable,
      available: false,
      decision: "denied_wrong_provider",
      network: config.STELLAR_NETWORK,
      wallet: input.wallet,
      mode: input.mode,
      provider: input.provider,
      providerName,
      grant: {
        maxAmountUsd: config.SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD,
        ttlSeconds: config.SPONSORSHIP_GRANT_TTL_SECONDS,
        expiresInSeconds: config.SPONSORSHIP_GRANT_TTL_SECONDS,
        restrictions
      },
      quotedPriceUsd,
      priceFitsGrant,
      perWalletBudget,
      globalBudget,
      reason: "unknown_provider"
    };
  }

  // Synthesize a hypothetical fresh grant using current policy config and ask
  // the real authorization path what it would decide.
  const synthesized = issueGrant(input.wallet);
  const result = authorizeSponsoredRun({
    signedGrant: synthesized,
    wallet: input.wallet,
    mode: input.mode,
    provider: input.provider
  });

  const expiresInSeconds = Math.max(
    Math.floor((new Date(synthesized.grant.expiresAt).getTime() - Date.now()) / 1000),
    0
  );

  // Carry over any policy-set restrictions from the synthesized grant so the
  // UI can show "locked to mode X / provider Y".
  restrictions.mode = synthesized.grant.mode ?? null;
  restrictions.providerId = synthesized.grant.providerId ?? null;

  return {
    sponsorshipEnabled,
    storageAvailable,
    available: result.allowed,
    decision: result.decision,
    network: config.STELLAR_NETWORK,
    wallet: input.wallet,
    mode: input.mode,
    provider: input.provider,
    providerName,
    grant: {
      maxAmountUsd: synthesized.grant.maxAmountUsd,
      ttlSeconds: config.SPONSORSHIP_GRANT_TTL_SECONDS,
      expiresInSeconds,
      restrictions
    },
    quotedPriceUsd,
    priceFitsGrant,
    perWalletBudget,
    globalBudget,
    ...(result.error ? { reason: result.error } : {})
  };
}
