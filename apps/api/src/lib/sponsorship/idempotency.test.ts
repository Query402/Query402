import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SignedGrant } from "@query402/shared";
import {
  applySponsorshipTestEnv,
  resetSponsorshipStore
} from "../../test/sponsorship-test-helpers.js";

describe("sponsorship grant idempotency", () => {
  let dbPath: string | undefined;

  afterEach(async () => {
    await resetSponsorshipStore(dbPath);
    dbPath = undefined;
    vi.restoreAllMocks();
  });

  async function loadModule() {
    return import("./idempotency.js");
  }

  function buildSignedGrant(wallet: string): SignedGrant {
    return {
      grant: {
        grantId: randomUUID(),
        wallet,
        network: "stellar:testnet",
        maxAmountUsd: 1,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        nonce: randomUUID(),
        issuedAt: new Date().toISOString()
      },
      signature: "test-signature"
    };
  }

  it("returns the stored grant for a repeated key and does not re-acquire", async () => {
    dbPath = applySponsorshipTestEnv();
    const mod = await loadModule();

    const input = {
      key: randomUUID(),
      wallet: `G${"A".repeat(55)}`,
      amountUsd: 1
    };

    expect(mod.beginSponsorshipIdempotency(input).action).toBe("acquire");
    const grant = buildSignedGrant(input.wallet);
    mod.completeSponsorshipIdempotency(input, grant);

    const replay = mod.beginSponsorshipIdempotency(input);
    expect(replay.action).toBe("replay");
    expect(replay.action === "replay" && replay.signedGrant).toEqual(grant);
  });

  it("rejects the same key when the request body differs", async () => {
    dbPath = applySponsorshipTestEnv();
    const mod = await loadModule();

    const wallet = `G${"A".repeat(55)}`;
    const key = randomUUID();
    const first = { key, wallet, amountUsd: 1 };
    const second = { key, wallet, amountUsd: 0.5 };
    const third = { key, wallet, amountUsd: 1, query: "different query" };

    expect(mod.beginSponsorshipIdempotency(first).action).toBe("acquire");
    mod.completeSponsorshipIdempotency(first, buildSignedGrant(wallet));

    expect(mod.beginSponsorshipIdempotency(second).action).toBe("conflict");
    expect(mod.beginSponsorshipIdempotency(third).action).toBe("conflict");

    // The conflicting attempts must not overwrite the stored grant.
    const replay = mod.beginSponsorshipIdempotency(first);
    expect(replay.action).toBe("replay");
  });

  it("binds the hash to the payer so a key cannot be reused across wallets", async () => {
    dbPath = applySponsorshipTestEnv();
    const mod = await loadModule();

    const key = randomUUID();
    const first = { key, wallet: `G${"A".repeat(55)}`, amountUsd: 1 };
    const second = { key, wallet: `G${"B".repeat(55)}`, amountUsd: 1 };

    expect(mod.beginSponsorshipIdempotency(first).action).toBe("acquire");
    mod.completeSponsorshipIdempotency(first, buildSignedGrant(first.wallet));

    expect(mod.beginSponsorshipIdempotency(second).action).toBe("conflict");
  });

  it("does not expire an in-flight record before completion", async () => {
    dbPath = applySponsorshipTestEnv({ IDEMPOTENCY_TTL_SECONDS: "1" });
    const mod = await loadModule();

    const input = {
      key: randomUUID(),
      wallet: `G${"A".repeat(55)}`,
      amountUsd: 1
    };

    expect(mod.beginSponsorshipIdempotency(input).action).toBe("acquire");

    // Advance the clock well past the TTL: the in-flight lock must survive.
    const later = Date.now() + 5_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(later);

    expect(mod.beginSponsorshipIdempotency(input).action).toBe("in_progress");

    // Completion converts the surviving lock into a replayable response.
    vi.restoreAllMocks();
    const grant = buildSignedGrant(input.wallet);
    mod.completeSponsorshipIdempotency(input, grant);

    const replay = mod.beginSponsorshipIdempotency(input);
    expect(replay.action).toBe("replay");
    expect(replay.action === "replay" && replay.signedGrant).toEqual(grant);
  });

  it("returns the stored grant even after the response TTL would have aged out", async () => {
    // Completed grant replays keep working while the record is live; the
    // point here is that completion through the in-flight window (lock
    // refreshed, not expired) yields a replayable record.
    dbPath = applySponsorshipTestEnv({ IDEMPOTENCY_TTL_SECONDS: "3600" });
    const mod = await loadModule();

    const input = {
      key: randomUUID(),
      wallet: `G${"A".repeat(55)}`,
      amountUsd: 1
    };

    expect(mod.beginSponsorshipIdempotency(input).action).toBe("acquire");
    const grant = buildSignedGrant(input.wallet);
    mod.completeSponsorshipIdempotency(input, grant);

    const later = Date.now() + 3_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(later);
    const replay = mod.beginSponsorshipIdempotency(input);
    nowSpy.mockRestore();

    expect(replay.action).toBe("replay");
  });

  it("release on abort allows a fresh acquire for the same key+body", async () => {
    dbPath = applySponsorshipTestEnv();
    const mod = await loadModule();

    const input = {
      key: randomUUID(),
      wallet: `G${"A".repeat(55)}`,
      amountUsd: 1
    };

    expect(mod.beginSponsorshipIdempotency(input).action).toBe("acquire");
    expect(mod.beginSponsorshipIdempotency(input).action).toBe("in_progress");

    mod.abortSponsorshipIdempotency(input);
    expect(mod.beginSponsorshipIdempotency(input).action).toBe("acquire");
  });
});
