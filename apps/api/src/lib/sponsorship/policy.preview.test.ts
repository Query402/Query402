import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  OTHER_WALLET,
  TEST_WALLET,
  applySponsorshipTestEnv,
  createSignedGrant,
  resetSponsorshipStore
} from "../../test/sponsorship-test-helpers.js";

describe("previewSponsoredRun", () => {
  let dbPath: string | undefined;

  afterEach(async () => {
    await resetSponsorshipStore(dbPath);
    vi.restoreAllMocks();
  });

  it("returns an allowed preview for a valid request and never includes a signature", async () => {
    dbPath = applySponsorshipTestEnv();
    const { previewSponsoredRun } = await import("./policy.js");

    const preview = previewSponsoredRun({
      wallet: TEST_WALLET,
      mode: "search",
      provider: "search.basic"
    });

    expect(preview.sponsorshipEnabled).toBe(true);
    expect(preview.storageAvailable).toBe(true);
    expect(preview.available).toBe(true);
    expect(preview.decision).toBe("allowed");
    expect(preview.network).toBe("stellar:testnet");
    expect(preview.wallet).toBe(TEST_WALLET);
    expect(preview.mode).toBe("search");
    expect(preview.provider).toBe("search.basic");
    expect(preview.providerName).toBe("Basic Search");
    expect(preview.quotedPriceUsd).toBe(0.01);
    expect(preview.priceFitsGrant).toBe(true);
    expect(preview.grant.maxAmountUsd).toBe(1);
    expect(preview.grant.ttlSeconds).toBe(300);
    expect(preview.grant.expiresInSeconds).toBeGreaterThan(0);
    expect(preview.grant.restrictions).toEqual({ mode: null, providerId: null });
    expect(JSON.stringify(preview)).not.toMatch(/"signature"/);
    expect(JSON.stringify(preview)).not.toMatch(/"nonce"/);
    expect(preview.perWalletBudget.limitUsd).toBe(1);
    expect(preview.globalBudget.limitUsd).toBe(10);
  });

  it("denies when sponsorship is disabled", async () => {
    dbPath = applySponsorshipTestEnv({ SPONSORSHIP_ENABLED: "false" });
    const { previewSponsoredRun } = await import("./policy.js");

    const preview = previewSponsoredRun({
      wallet: TEST_WALLET,
      mode: "search",
      provider: "search.basic"
    });

    expect(preview.sponsorshipEnabled).toBe(false);
    expect(preview.available).toBe(false);
    expect(preview.decision).toBe("denied_sponsorship_disabled");
    expect(preview.reason).toBe("sponsorship_disabled");
  });

  it("denies when storage is unavailable", async () => {
    dbPath = applySponsorshipTestEnv();
    const store = await import("./store.js");
    vi.spyOn(store, "isSponsorshipStorageAvailable").mockReturnValue(false);
    const { previewSponsoredRun } = await import("./policy.js");

    const preview = previewSponsoredRun({
      wallet: TEST_WALLET,
      mode: "search",
      provider: "search.basic"
    });

    expect(preview.sponsorshipEnabled).toBe(true);
    expect(preview.storageAvailable).toBe(false);
    expect(preview.available).toBe(false);
    expect(preview.decision).toBe("denied_storage_unavailable");
  });

  it("denies unknown provider", async () => {
    dbPath = applySponsorshipTestEnv();
    const { previewSponsoredRun } = await import("./policy.js");

    const preview = previewSponsoredRun({
      wallet: TEST_WALLET,
      mode: "search",
      provider: "nonexistent.provider"
    });

    expect(preview.available).toBe(false);
    expect(preview.decision).toBe("denied_wrong_provider");
    expect(preview.reason).toBe("unknown_provider");
  });

  it("denies when provider and mode mismatched", async () => {
    dbPath = applySponsorshipTestEnv();
    const { previewSponsoredRun } = await import("./policy.js");

    const preview = previewSponsoredRun({
      wallet: TEST_WALLET,
      mode: "news",
      provider: "search.basic"
    });

    expect(preview.available).toBe(false);
    expect(preview.decision).toBe("denied_wrong_provider");
  });

  it("does not consume budget across invocations", async () => {
    dbPath = applySponsorshipTestEnv({
      SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD: "0.01"
    });
    const { previewSponsoredRun } = await import("./policy.js");

    const first = previewSponsoredRun({
      wallet: TEST_WALLET,
      mode: "search",
      provider: "search.basic"
    });
    expect(first.available).toBe(true);

    // After a hypothetical reservation, real budget would be exceeded on the
    // second call only if preview consumed budget. Multiple previews must
    // remain allowed because they are read-only.
    const second = previewSponsoredRun({
      wallet: TEST_WALLET,
      mode: "search",
      provider: "search.basic"
    });
    expect(second.available).toBe(true);
    expect(second.perWalletBudget.spentUsd).toBe(0);
  });

  it("reflects current spent budget in preview totals", async () => {
    dbPath = applySponsorshipTestEnv({
      SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD: "0.05"
    });
    const { previewSponsoredRun } = await import("./policy.js");
    const { checkAndReserveBudget } = await import("./budget.js");

    checkAndReserveBudget({
      wallet: TEST_WALLET,
      amountUsd: 0.02,
      nonce: (await createSignedGrant()).grant.nonce,
      grantId: "grant-existing"
    });

    const preview = previewSponsoredRun({
      wallet: TEST_WALLET,
      mode: "search",
      provider: "search.basic"
    });

    expect(preview.available).toBe(true);
    expect(preview.perWalletBudget.spentUsd).toBeCloseTo(0.02, 6);
    expect(preview.perWalletBudget.remainingUsd).toBeCloseTo(0.03, 6);
  });

  it("does not let a different wallet spend the prior wallet's preview state", async () => {
    dbPath = applySponsorshipTestEnv({
      SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD: "0.05"
    });
    const { previewSponsoredRun } = await import("./policy.js");
    const { checkAndReserveBudget } = await import("./budget.js");

    checkAndReserveBudget({
      wallet: TEST_WALLET,
      amountUsd: 0.02,
      nonce: (await createSignedGrant()).grant.nonce,
      grantId: "grant-other"
    });

    const preview = previewSponsoredRun({
      wallet: OTHER_WALLET,
      mode: "search",
      provider: "search.basic"
    });

    expect(preview.perWalletBudget.spentUsd).toBe(0);
  });
});

describe("POST /api/sponsorship/preview", () => {
  let dbPath: string | undefined;
  let app: express.Express;

  async function buildApp() {
    const { sponsorshipRouter } = await import("../../routes/sponsorship.js");
    const expressApp = express();
    expressApp.use(express.json());
    expressApp.use(sponsorshipRouter);
    return expressApp;
  }

  afterEach(async () => {
    await resetSponsorshipStore(dbPath);
    vi.restoreAllMocks();
  });

  it("returns a preview JSON and never leaks signature or nonce fields", async () => {
    dbPath = applySponsorshipTestEnv();
    app = await buildApp();

    const response = await request(app)
      .post("/api/sponsorship/preview")
      .send({ wallet: TEST_WALLET, mode: "search", provider: "search.basic" });

    expect(response.status).toBe(200);
    expect(response.body.available).toBe(true);
    expect(response.body.decision).toBe("allowed");
    expect(JSON.stringify(response.body)).not.toMatch(/"signature"/);
    expect(JSON.stringify(response.body)).not.toMatch(/"nonce"/);
  });

  it("returns 400 for invalid wallet", async () => {
    dbPath = applySponsorshipTestEnv();
    app = await buildApp();

    const response = await request(app)
      .post("/api/sponsorship/preview")
      .send({ wallet: "not-a-stellar-key", mode: "search", provider: "search.basic" });

    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid mode", async () => {
    dbPath = applySponsorshipTestEnv();
    app = await buildApp();

    const response = await request(app)
      .post("/api/sponsorship/preview")
      .send({ wallet: TEST_WALLET, mode: "invalid", provider: "search.basic" });

    expect(response.status).toBe(400);
  });

  it("returns 200 with denied decision when sponsorship is disabled", async () => {
    dbPath = applySponsorshipTestEnv({ SPONSORSHIP_ENABLED: "false" });
    app = await buildApp();

    const response = await request(app)
      .post("/api/sponsorship/preview")
      .send({ wallet: TEST_WALLET, mode: "search", provider: "search.basic" });

    expect(response.status).toBe(200);
    expect(response.body.sponsorshipEnabled).toBe(false);
    expect(response.body.decision).toBe("denied_sponsorship_disabled");
  });
});
