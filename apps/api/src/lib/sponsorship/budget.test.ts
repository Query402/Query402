import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  OTHER_WALLET,
  TEST_WALLET,
  applySponsorshipTestEnv,
  createSignedGrant,
  readGlobalBudgetSpent,
  readWalletBudgetSpent,
  resetSponsorshipStore
} from "../../test/sponsorship-test-helpers.js";

describe("sponsorship budget store", () => {
  let dbPath: string;

  afterEach(async () => {
    await resetSponsorshipStore(dbPath);
  });

  it("reserves budget atomically for a valid spend", async () => {
    dbPath = applySponsorshipTestEnv();
    const { checkAndReserveBudget } = await import("./budget.js");
    const signedGrant = await createSignedGrant();

    checkAndReserveBudget({
      wallet: TEST_WALLET,
      amountUsd: 0.01,
      nonce: signedGrant.grant.nonce,
      grantId: signedGrant.grant.grantId
    });

    expect(await readWalletBudgetSpent(TEST_WALLET)).toBeCloseTo(0.01, 6);
    expect(await readGlobalBudgetSpent()).toBeCloseTo(0.01, 6);
  });

  it("rejects nonce replay during reservation", async () => {
    dbPath = applySponsorshipTestEnv();
    const { checkAndReserveBudget, SponsorshipNonceReplayError } = await import("./budget.js");
    const signedGrant = await createSignedGrant();

    checkAndReserveBudget({
      wallet: TEST_WALLET,
      amountUsd: 0.01,
      nonce: signedGrant.grant.nonce,
      grantId: signedGrant.grant.grantId
    });

    expect(() =>
      checkAndReserveBudget({
        wallet: TEST_WALLET,
        amountUsd: 0.01,
        nonce: signedGrant.grant.nonce,
        grantId: signedGrant.grant.grantId
      })
    ).toThrow(SponsorshipNonceReplayError);
  });

  it("keeps aggregate spend within per-wallet budget across different nonces", async () => {
    dbPath = applySponsorshipTestEnv({
      SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD: "0.05"
    });
    const { checkAndReserveBudget, SponsorshipBudgetExceededError } = await import("./budget.js");

    let successes = 0;

    for (let index = 0; index < 10; index += 1) {
      try {
        checkAndReserveBudget({
          wallet: TEST_WALLET,
          amountUsd: 0.01,
          nonce: randomUUID(),
          grantId: randomUUID()
        });
        successes += 1;
      } catch (error) {
        expect(error).toBeInstanceOf(SponsorshipBudgetExceededError);
      }
    }

    expect(successes).toBe(5);
    expect(await readWalletBudgetSpent(TEST_WALLET)).toBeLessThanOrEqual(0.05);
    expect(await readWalletBudgetSpent(TEST_WALLET)).toBeCloseTo(0.05, 6);
  });

  it("enforces global budget across wallets", async () => {
    dbPath = applySponsorshipTestEnv({
      SPONSORSHIP_GLOBAL_DAILY_BUDGET_USD: "0.01",
      SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD: "1"
    });
    const { checkAndReserveBudget, SponsorshipBudgetExceededError } = await import("./budget.js");
    const { config } = await import("../config.js");

    expect(config.SPONSORSHIP_GLOBAL_DAILY_BUDGET_USD).toBe(0.01);

    checkAndReserveBudget({
      wallet: TEST_WALLET,
      amountUsd: 0.01,
      nonce: randomUUID(),
      grantId: randomUUID()
    });

    expect(() =>
      checkAndReserveBudget({
        wallet: OTHER_WALLET,
        amountUsd: 0.01,
        nonce: randomUUID(),
        grantId: randomUUID()
      })
    ).toThrow(SponsorshipBudgetExceededError);

    expect(await readGlobalBudgetSpent()).toBeCloseTo(0.01, 6);
  });

  it("releases reserved budget on failure rollback", async () => {
    dbPath = applySponsorshipTestEnv();
    const { checkAndReserveBudget, releaseBudget } = await import("./budget.js");

    checkAndReserveBudget({
      wallet: TEST_WALLET,
      amountUsd: 0.01,
      nonce: randomUUID(),
      grantId: randomUUID()
    });

    releaseBudget(TEST_WALLET, 0.01);

    expect(await readWalletBudgetSpent(TEST_WALLET)).toBeCloseTo(0, 6);
    expect(await readGlobalBudgetSpent()).toBeCloseTo(0, 6);
  });

  it("allows only one of two overlapping grants to spend the last unit", async () => {
    dbPath = applySponsorshipTestEnv({
      SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD: "0.01",
      SPONSORSHIP_GLOBAL_DAILY_BUDGET_USD: "0.01"
    });
    const { checkAndReserveBudget, SponsorshipBudgetExceededError } = await import("./budget.js");

    const first = await createSignedGrant();
    const second = await createSignedGrant();

    checkAndReserveBudget({
      wallet: TEST_WALLET,
      amountUsd: 0.01,
      nonce: first.grant.nonce,
      grantId: first.grant.grantId
    });

    expect(() =>
      checkAndReserveBudget({
        wallet: OTHER_WALLET,
        amountUsd: 0.01,
        nonce: second.grant.nonce,
        grantId: second.grant.grantId
      })
    ).toThrow(SponsorshipBudgetExceededError);

    expect(await readWalletBudgetSpent(TEST_WALLET)).toBeCloseTo(0.01, 6);
    expect(await readGlobalBudgetSpent()).toBeCloseTo(0.01, 6);
  });
});
