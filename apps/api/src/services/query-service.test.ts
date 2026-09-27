import { beforeEach, describe, expect, it, vi } from "vitest";

const registryExecuteMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock("../providers/index.js", () => ({
  registry: {
    execute: (...args: unknown[]) => registryExecuteMock(...args)
  }
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    error: (...args: unknown[]) => loggerErrorMock(...args)
  }
}));

describe("executeQuery", () => {
  beforeEach(() => {
    registryExecuteMock.mockReset();
    loggerErrorMock.mockReset();
    vi.resetModules();
  });

  it("rejects unsafe scrape URLs at the service boundary", async () => {
    process.env.X402_PAY_TO_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const [{ executeQuery }, { UnsafeScrapeUrlError }] = await Promise.all([
      import("./query-service.js"),
      import("../lib/scrape-url-safety.js")
    ]);

    await expect(
      executeQuery({
        mode: "scrape",
        provider: "scrape.page",
        url: "http://169.254.169.254/latest/meta-data"
      })
    ).rejects.toBeInstanceOf(UnsafeScrapeUrlError);
  });

  it("logs provider failures with safe metadata only", async () => {
    process.env.X402_PAY_TO_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const providerError = new Error(
      'upstream failed query="super secret question" url=https://secret.example.test/search payment-response=proof_123 Authorization:Bearer token_abc privateKey=wallet_secret'
    );
    registryExecuteMock.mockRejectedValueOnce(providerError);

    const { executeQuery } = await import("./query-service.js");

    await expect(
      executeQuery({
        mode: "search",
        provider: "search.live",
        q: "super secret question"
      })
    ).rejects.toThrow(providerError.message);

    expect(loggerErrorMock).toHaveBeenCalledTimes(1);

    const [payload, message] = loggerErrorMock.mock.calls[0];
    const serializedPayload = JSON.stringify(payload);

    expect(message).toBe("provider execution failed");
    expect(payload).toMatchObject({
      providerId: "search.live",
      mode: "search",
      errorClass: "Error"
    });
    expect(payload.errorMessage).toContain("[redacted-url]");
    expect(serializedPayload).not.toContain("super secret question");
    expect(serializedPayload).not.toContain("https://secret.example.test/search");
    expect(serializedPayload).not.toContain("proof_123");
    expect(serializedPayload).not.toContain("token_abc");
    expect(serializedPayload).not.toContain("wallet_secret");
  });
});

describe("getCatalog deterministic ordering", () => {
  it("returns providers in the shared canonical order", async () => {
    const [{ getCatalog }, { compareProviders, providers, sortProviderCatalog }] =
      await Promise.all([import("./query-service.js"), import("../lib/pricing.js")]);

    const catalog = getCatalog();

    expect(catalog.providers.map((provider) => provider.id)).toEqual(
      sortProviderCatalog(providers).map((provider) => provider.id)
    );
    for (let i = 1; i < catalog.providers.length; i++) {
      expect(
        compareProviders(catalog.providers[i - 1], catalog.providers[i])
      ).toBeLessThanOrEqual(0);
    }
  });

  it("sorts every byCategory grouping with the same canonical order", async () => {
    const [{ getCatalog }, { compareProviders }] = await Promise.all([
      import("./query-service.js"),
      import("../lib/pricing.js")
    ]);

    const catalog = getCatalog();

    for (const category of ["search", "news", "scrape"] as const) {
      const group = catalog.byCategory[category];
      expect(group.length).toBeGreaterThan(0);
      expect(group.every((provider) => provider.category === category)).toBe(true);
      for (let i = 1; i < group.length; i++) {
        expect(compareProviders(group[i - 1], group[i])).toBeLessThanOrEqual(0);
      }
    }
  });

  it("does not mutate the stored catalog array or its order", async () => {
    const [{ getCatalog }, { providers }] = await Promise.all([
      import("./query-service.js"),
      import("../lib/pricing.js")
    ]);

    const originalIds = providers.map((provider) => provider.id);
    getCatalog();

    expect(providers.map((provider) => provider.id)).toEqual(originalIds);
  });

  it("returns a sorted copy rather than the stored array reference", async () => {
    const [{ getCatalog }, { providers }] = await Promise.all([
      import("./query-service.js"),
      import("../lib/pricing.js")
    ]);

    const originalIds = providers.map((provider) => provider.id);
    const catalog = getCatalog();

    expect(catalog.providers).not.toBe(providers);

    // Mutating the response must not be able to reshape the stored catalog.
    catalog.providers.length = 0;
    expect(providers.map((provider) => provider.id)).toEqual(originalIds);
  });
});
