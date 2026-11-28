import type Database from "better-sqlite3";
import { config } from "../config.js";
import { getSponsorshipDb, runInTransaction } from "./store.js";

export class SponsorshipNonceReplayError extends Error {
  readonly name = "SponsorshipNonceReplayError";
}

export class SponsorshipBudgetExceededError extends Error {
  readonly name = "SponsorshipBudgetExceededError";

  constructor(public readonly scope: "wallet" | "global") {
    super(`budget exceeded: ${scope}`);
  }
}

export class SponsorshipPreviewMismatchError extends Error {
  readonly name = "SponsorshipPreviewMismatchError";

  constructor(
    public readonly expectedAmountUsd: number,
    public readonly actualAmountUsd: number
  ) {
    super(

      `preview amount ${expectedAmountUsd} does not match budget amount ${actualAmountUsd}`
    );
  }
}

export function getDailyWindowStart(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function exceedsBudgetLimit(spentUsd: number, amountUsd: number, limitUsd: number): boolean {
  return Number((spentUsd + amountUsd).toFixed(6)) > Number(limitUsd.toFixed(6));
}

export function readSpentUsd(
  database: Database.Database,
  scope: "global" | "wallet",
  wallet: string | null,
  windowStart: string
): number {
  const row = database
    .prepare(
      `SELECT spent_usd
       FROM sponsorship_budgets
       WHERE scope = ? AND wallet IS ? AND window_start = ?`
    )
    .get(scope, wallet, windowStart) as { spent_usd: number } | undefined;

  return row?.spent_usd ?? 0;
}

function incrementBudget(
  database: Database.Database,
  scope: "global" | "wallet",
  wallet: string | null,
  windowStart: string,
  amountUsd: number
): void {
  database
    .prepare(
      `INSERT INTO sponsorship_budgets (scope, wallet, spent_usd, window_start)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(scope, wallet, window_start)
       DO UPDATE SET spent_usd = spent_usd + excluded.spent_usd`
    )
    .run(scope, wallet, amountUsd, windowStart);
}

function decrementBudget(
  database: Database.Database,
  scope: "global" | "wallet",
  wallet: string | null,
  windowStart: string,
  amountUsd: number
): void {
  database
    .prepare(
      `UPDATE sponsorship_budgets
       SET spent_usd = MAX(0, spent_usd - ?)
       WHERE scope = ? AND wallet IS ? AND window_start = ?`
    )
    .run(amountUsd, scope, wallet, windowStart);
}

export function isNonceConsumed(nonce: string): boolean {
  const database = getSponsorshipDb();
  const row = database
    .prepare(`SELECT 1 AS found FROM sponsorship_nonces WHERE nonce = ?`)
    .get(nonce);
  return Boolean(row);
}

export function wouldExceedBudget(
  wallet: string,
  amountUsd: number,
  windowStart = getDailyWindowStart()
): "wallet" | "global" | null {
  const database = getSponsorshipDb();
  const walletSpent = readSpentUsd(database, "wallet", wallet, windowStart);

  if (exceedsBudgetLimit(walletSpent, amountUsd, config.SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD)) {
    return "wallet";
  }

  const globalSpent = readSpentUsd(database, "global", null, windowStart);

  if (exceedsBudgetLimit(globalSpent, amountUsd, config.SPONSORSHIP_GLOBAL_DAILY_BUDGET_USD)) {
    return "global";
  }

  return null;
}

export function checkAndReserveBudget(input: {
  wallet: string;
  amountUsd: number;
  nonce: string;
  grantId: string;
}): void {
  runInTransaction((database) => {
    const windowStart = getDailyWindowStart();
    const consumedAt = new Date().toISOString();

    const existingNonce = database
      .prepare(`SELECT 1 AS found FROM sponsorship_nonces WHERE nonce = ?`)
      .get(input.nonce);

    if (existingNonce) {
      throw new SponsorshipNonceReplayError();
    }

    const walletSpent = readSpentUsd(database, "wallet", input.wallet, windowStart);
    if (
      exceedsBudgetLimit(
        walletSpent,
        input.amountUsd,
        config.SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD
      )
    ) {
      throw new SponsorshipBudgetExceededError("wallet");
    }

    const globalSpent = readSpentUsd(database, "global", null, windowStart);
    if (
      exceedsBudgetLimit(globalSpent, input.amountUsd, config.SPONSORSHIP_GLOBAL_DAILY_BUDGET_USD)
    ) {
      throw new SponsorshipBudgetExceededError("global");
    }

    database
      .prepare(
        `INSERT INTO sponsorship_nonces (nonce, grant_id, consumed_at)
         VALUES (?, ?, ?)`
      )
      .run(input.nonce, input.grantId, consumedAt);

    incrementBudget(database, "wallet", input.wallet, windowStart, input.amountUsd);
    incrementBudget(database, "global", null, windowStart, input.amountUsd);
  });
}

/** Reservation is finalized inside checkAndReserveBudget. */
export function commitBudget(): void {}

export function releaseBudget(wallet: string, amountUsd: number): void {
  runInTransaction((database) => {
    const windowStart = getDailyWindowStart();
    decrementBudget(database, "wallet", wallet, windowStart, amountUsd);
    decrementBudget(database, "global", null, windowStart, amountUsd);
  });
}

export interface BudgetSnapshot {
  windowStart: string;
  walletSpentUsd: number;
  globalSpentUsd: number;
  walletRemainingUsd: number;
  globalRemainingUsd: number;
  walletLimitUsd: number;
  globalLimitUsd: number;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6));
}

export function readBudgetSnapshot(wallet: string, windowStart = getDailyWindowStart()): BudgetSnapshot {
  const database = getSponsorshipDb();
  const walletSpentUsd = readSpentUsd(database, "wallet", wallet, windowStart);
  const globalSpentUsd = readSpentUsd(database, "global", null, windowStart);
  const walletLimitUsd = config.SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD;
  const globalLimitUsd = config.SPONSORSHIP_GLOBAL_DAILY_BUDGET_USD;

  return {
    windowStart,
    walletSpentUsd,
    globalSpentUsd,
    walletRemainingUsd: roundUsd(Math.max(walletLimitUsd - walletSpentUsd, 0)),
    globalRemainingUsd: roundUsd(Math.max(globalLimitUsd - globalSpentUsd, 0)),
    walletLimitUsd,
    globalLimitUsd
  };
}

export function getRemainingBudget(wallet: string): number | null {
  return readBudgetSnapshot(wallet).walletRemainingUsd;
}

export interface GrantWithDebitInput {
  wallet: string;
  amountUsd: number;
  nonce: string;
  grantId: string;
  /** Amount the policy preview authorized. Must match `amountUsd`. */
  previewAmountUsd: number;
}

/**
 * Atomically applies the grant debit only when the policy preview and the
 * budget store agree on the exact spend. The nonce insert, budget debit, and
 * amount validation all run inside a single transaction, so a failed grant
 * leaves the remaining budget unchanged and two overlapping grants cannot
 * spend the last unit twice.
 */
export function grantWithDebit(input: GrantWithDebitInput): void {
  if (Number(input.previewAmountUsd.toFixed(6)) !== Number(input.amountUsd.toFixed(6))) {
    throw new SponsorshipPreviewMismatchError(input.previewAmountUsd, input.amountUsd);
  }

  checkAndReserveBudget({
    wallet: input.wallet,
    amountUsd: input.amountUsd,
    nonce: input.nonce,
    grantId: input.grantId
  });
}
