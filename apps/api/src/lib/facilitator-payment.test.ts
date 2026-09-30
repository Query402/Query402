import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyApiTestEnv, resetApiTestStorage, TEST_WALLET } from "../test/api-test-helpers.js";

describe("facilitator priced payment", () => {
  let analyticsDbPath: string;
  let sponsorshipDbPath: string;

  beforeEach(() => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv());
  });

  afterEach(async () => {
    await resetApiTestStorage(analyticsDbPath, sponsorshipDbPath);
    vi.restoreAllMocks();
  });

  function confirmed(overrides: Record<string, string> = {}) {
    return {
      asset: "USDC",
      amount: "0.01",
      destination: TEST_WALLET,
      ...overrides
    };
  }

  async function confirmAndRun<T>(input: {
    providerId: string;
    facilitatorResult: ReturnType<typeof confirmed> | null;
    run: () => T;
  }) {
    const { runProviderAfterConfirmation } = await import("./facilitator-check.js");
    return runProviderAfterConfirmation(input);
  }

  it("runs the provider once after a confirmed matching payment", async () => {
    const { executeQuery } = await import("../services/query-service.js");
    const result = await executeQuery(
      { mode: "search", provider: "search.basic", q: "stellar" },
      { facilitatorResult: confirmed() }
    );

    expect(result.providerId).toBe("search.basic");
    expect(result.items.length).toBeGreaterThan(0);

    const run = vi.fn(() => "once");
    expect(
      await confirmAndRun({
        providerId: "search.basic",
        facilitatorResult: confirmed(),
        run
      })
    ).toBe("once");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run the provider for a short amount", async () => {
    const { executeQuery } = await import("../services/query-service.js");
    const run = vi.fn();

    await expect(
      executeQuery(
        { mode: "search", provider: "search.basic", q: "stellar" },
        { facilitatorResult: confirmed({ amount: "0.001" }) }
      )
    ).rejects.toThrow(/payment_not_confirmed/);
    await expect(
      confirmAndRun({
        providerId: "search.basic",
        facilitatorResult: confirmed({ amount: "0.001" }),
        run
      })
    ).rejects.toThrow(/payment_not_confirmed/);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not run the provider for a different asset and hides the payment secret", async () => {
    const secret = "SSECRETVALUE";
    const run = vi.fn();

    await expect(
      confirmAndRun({
        providerId: "search.basic",
        facilitatorResult: confirmed({ asset: "XLM", secret }),
        run
      })
    ).rejects.toThrow(/payment_not_confirmed/);

    try {
      await confirmAndRun({
        providerId: "search.basic",
        facilitatorResult: confirmed({ asset: "XLM", secret }),
        run
      });
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
    expect(run).not.toHaveBeenCalled();
  });
});
