import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyApiTestEnv, resetApiTestStorage } from "../test/api-test-helpers.js";

describe("facilitator-check", () => {
  let analyticsDbPath: string;

  beforeEach(() => {
    ({ analyticsDbPath } = applyApiTestEnv());
  });

  afterEach(async () => {
    await resetApiTestStorage(analyticsDbPath);
  });

  it("returns false in demo mode without making network requests", async () => {
    const { checkFacilitatorSupported } = await import("../lib/facilitator-check.js");

    const result = await checkFacilitatorSupported();

    expect(result.ok).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("returns cached false when no API key is configured", async () => {
    const { checkFacilitatorSupported } = await import("../lib/facilitator-check.js");

    const result = await checkFacilitatorSupported();

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("apiKey");
    expect(result).not.toHaveProperty("secret");
  });

  it("clearFacilitatorCache resets cached state", async () => {
    const { checkFacilitatorSupported, clearFacilitatorCache } =
      await import("../lib/facilitator-check.js");

    clearFacilitatorCache();
    await checkFacilitatorSupported();

    let result = await checkFacilitatorSupported();
    expect(result.ok).toBe(false);

    clearFacilitatorCache();

    result = await checkFacilitatorSupported();
    expect(result.ok).toBe(false);
  });
});
