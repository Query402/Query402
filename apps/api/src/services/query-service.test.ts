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
  it("returns providers sorted by category, then price, then id", async () => {
    const { getCatalog } = await import("./query-service.js");
    const catalog = getCatalog();

    const sorted = catalog.providers;
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];

      if (current.category !== next.category) {
        expect(current.category.localeCompare(next.category)).toBeLessThan(0);
      } else if (current.priceUsd !== next.priceUsd) {
        expect(current.priceUsd).toBeLessThan(next.priceUsd);
      } else {
        expect(current.id.localeCompare(next.id)).toBeLessThan(0);
      }
    }
  });

  it("sorts each category grouping deterministically", async () => {
    const { getCatalog } = await import("./query-service.js");
    const catalog = getCatalog();

    for (const category of ["search", "news", "scrape"] as const) {
      const group = catalog.byCategory[category];
      for (let i = 0; i < group.length - 1; i++) {
        const current = group[i];
        const next = group[i + 1];

        if (current.priceUsd !== next.priceUsd) {
          expect(current.priceUsd).toBeLessThan(next.priceUsd);
        } else {
          expect(current.id.localeCompare(next.id)).toBeLessThan(0);
        }
      }
    }
  });

  it("does not mutate the stored catalog array", async () => {
    const { getCatalog } = await import("./query-service.js");
    const { providers } = await import("../lib/pricing.js");

    const originalOrder = providers.map((p) => p.id);
    getCatalog();

    expect(providers.map((p) => p.id)).toEqual(originalOrder);
  });

  it("returns a copy, not the stored array reference", async () => {
    const { getCatalog } = await import("./query-service.js");
    const { providers } = await import("../lib/pricing.js");

    const catalog = getCatalog();
    expect(catalog.providers).not.toBe(providers);
  });
});
