import { describe, expect, it } from "vitest";
import { MICRO_USD_PER_USD } from "./schemas.js";
import {
  buildPaymentLink,
  catalogPriceToPaymentAmount,
  InvalidPaymentLinkError,
  type PaymentLinkIssue
} from "./payment-links.js";

const TEST_WALLET = `G${"A".repeat(55)}`;
const OTHER_WALLET = `G${"B".repeat(55)}`;

const STELLAR_SECRET_PATTERN = /\bS[A-Z0-9]{55}\b/;
const RAW_TX_HASH_PATTERN = /\b[0-9a-fA-F]{64}\b/;
const RAW_XDR_PATTERN = /\bAAAA[A-Za-z0-9+/]{40,}={0,2}\b/;
const ALL_SECRET_PATTERNS = [STELLAR_SECRET_PATTERN, RAW_TX_HASH_PATTERN, RAW_XDR_PATTERN];

const validInput = {
  amount: 50_000,
  asset: "USDC",
  destination: TEST_WALLET,
  network: "stellar:testnet"
};

function invalidAmount(overrides: Partial<typeof validInput> = {}): unknown {
  return { ...validInput, ...overrides };
}

function paymentAmountFromUrl(url: string): string {
  return new URL(url).searchParams.get("amount") ?? "";
}

function expectNoSecret(text: string): void {
  for (const pattern of ALL_SECRET_PATTERNS) {
    expect(text).not.toMatch(pattern);
  }
}

describe("buildPaymentLink — valid inputs", () => {
  it("produces exactly one link for a valid price", () => {
    const links = Array.from({ length: 3 }, () => buildPaymentLink(validInput));
    expect(links).toHaveLength(3);
    expect(new Set(links.map((link) => link.url)).size).toBe(1);
    expect(links[0]!.url).toBe(
      `https://stellar.expert/explorer/testnet/payment?amount=0.050000&asset=USDC&destination=${TEST_WALLET}&network=stellar%3Atestnet`
    );
  });

  it("carries the integer amount, asset, destination, and network unchanged", () => {
    const link = buildPaymentLink(validInput);
    expect(link.amount).toBe(50_000);
    expect(link.asset).toBe("USDC");
    expect(link.destination).toBe(TEST_WALLET);
    expect(link.network).toBe("stellar:testnet");
  });

  it("renders the URL amount from integer micro-USD with no floating point drift", () => {
    expect(paymentAmountFromUrl(buildPaymentLink(validInput).url)).toBe("0.050000");
    expect(paymentAmountFromUrl(buildPaymentLink({ ...validInput, amount: 1 }).url)).toBe(
      "0.000001"
    );
    expect(paymentAmountFromUrl(buildPaymentLink({ ...validInput, amount: 10_000 }).url)).toBe(
      "0.010000"
    );
    expect(
      paymentAmountFromUrl(buildPaymentLink({ ...validInput, amount: MICRO_USD_PER_USD }).url)
    ).toBe("1.000000");
  });

  it("targets the public explorer for stellar:pubnet", () => {
    const link = buildPaymentLink({ ...validInput, network: "stellar:pubnet" });
    expect(link.url).toMatch(/^https:\/\/stellar\.expert\/explorer\/public\/payment\?/);
  });
});

describe("buildPaymentLink — refused amounts", () => {
  it("produces no link for a zero amount", () => {
    expect(() => buildPaymentLink(invalidAmount({ amount: 0 }))).toThrow(InvalidPaymentLinkError);
  });

  it("produces no link for a negative amount", () => {
    expect(() => buildPaymentLink(invalidAmount({ amount: -5_000 }))).toThrow(
      InvalidPaymentLinkError
    );
  });

  it("produces no link for a non-integer amount", () => {
    expect(() => buildPaymentLink(invalidAmount({ amount: 50_000.5 }))).toThrow(
      InvalidPaymentLinkError
    );
  });

  it("produces no link for a float imprecision artifact", () => {
    expect(() => buildPaymentLink(invalidAmount({ amount: 0.1 + 0.2 }))).toThrow(
      InvalidPaymentLinkError
    );
  });

  it("produces no link for a non-numeric amount", () => {
    expect(() => buildPaymentLink(invalidAmount({ amount: "50000" }))).toThrow(
      InvalidPaymentLinkError
    );
  });
});

describe("buildPaymentLink — refused destination, asset, and network", () => {
  it("produces no link for a missing destination", () => {
    const { destination: _omitted, ...withoutDestination } = validInput;
    expect(() => buildPaymentLink(withoutDestination)).toThrow(InvalidPaymentLinkError);
  });

  it("produces no link for an invalid destination", () => {
    expect(() => buildPaymentLink(invalidAmount({ destination: "" }))).toThrow(
      InvalidPaymentLinkError
    );
    expect(() =>
      buildPaymentLink(invalidAmount({ destination: OTHER_WALLET.slice(0, 54) }))
    ).toThrow(InvalidPaymentLinkError);
  });

  it("produces no link for an invalid asset", () => {
    expect(() => buildPaymentLink(invalidAmount({ asset: "usdc" }))).toThrow(
      InvalidPaymentLinkError
    );
    expect(() => buildPaymentLink(invalidAmount({ asset: "" }))).toThrow(InvalidPaymentLinkError);
  });

  it("produces no link for an invalid network", () => {
    expect(() => buildPaymentLink(invalidAmount({ network: "testnet" }))).toThrow(
      InvalidPaymentLinkError
    );
    expect(() => buildPaymentLink(invalidAmount({ network: "" }))).toThrow(InvalidPaymentLinkError);
  });

  it("produces no link when the input is not a payment payload", () => {
    expect(() => buildPaymentLink(null)).toThrow(InvalidPaymentLinkError);
    expect(() => buildPaymentLink(undefined)).toThrow(InvalidPaymentLinkError);
    expect(() => buildPaymentLink("0.05 USDC")).toThrow(InvalidPaymentLinkError);
    expect(() => buildPaymentLink(50_000)).toThrow(InvalidPaymentLinkError);
    expect(() => buildPaymentLink(["50_000"])).toThrow(InvalidPaymentLinkError);
  });

  it("reports every invalid field, in schema order", () => {
    try {
      buildPaymentLink({ asset: "usdc", network: "testnet", amount: 0 });
      expect.unreachable("buildPaymentLink should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPaymentLinkError);
      const paymentLinkError = error as InvalidPaymentLinkError;
      expect(paymentLinkError.code).toBe("invalid_payment_link");
      expect(paymentLinkError.issues.map((issue) => issue.field)).toEqual([
        "amount",
        "asset",
        "destination",
        "network"
      ]);
    }
  });
});

describe("buildPaymentLink — error hygiene", () => {
  it("keeps the error free of any secret-shaped content", () => {
    const secretishInput = {
      ...validInput,
      amount: 0,
      destination: "SBU4V2PLOHV6J3Z3W2N3M3K3L3J3H3G3F3E3D3C3B3A3938373635343"
    };
    try {
      buildPaymentLink(secretishInput);
      expect.unreachable("buildPaymentLink should have thrown");
    } catch (error) {
      expectNoSecret((error as Error).message);
      expectNoSecret(JSON.stringify((error as InvalidPaymentLinkError).issues));
    }
  });

  it("keeps the built link free of any secret-shaped content", () => {
    const link = buildPaymentLink(validInput);
    expectNoSecret(link.url);
    expectNoSecret(JSON.stringify(link));
  });

  it("surfaces the offending field in the error message", () => {
    try {
      buildPaymentLink(invalidAmount({ asset: "" }));
      expect.unreachable("buildPaymentLink should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("asset");
    }
  });

  it("does not echo the full supplied destination in the error issues", () => {
    try {
      buildPaymentLink(invalidAmount({ destination: "short" }));
      expect.unreachable("buildPaymentLink should have thrown");
    } catch (error) {
      const issues = (error as InvalidPaymentLinkError).issues as Array<
        Pick<PaymentLinkIssue, "field" | "message">
      >;
      expect(issues).toHaveLength(1);
      expect(issues[0]!.field).toBe("destination");
    }
  });
});

describe("catalogPriceToPaymentAmount", () => {
  it("converts catalog prices to whole micro-USD integers", () => {
    expect(catalogPriceToPaymentAmount(0.05)).toBe(50_000);
    expect(catalogPriceToPaymentAmount(0.01)).toBe(10_000);
    expect(catalogPriceToPaymentAmount(0.015)).toBe(15_000);
    expect(catalogPriceToPaymentAmount(1)).toBe(MICRO_USD_PER_USD);
  });

  it("feeds the catalog price into buildPaymentLink without floating point", () => {
    const amount = catalogPriceToPaymentAmount(0.02);
    expect(Number.isInteger(amount)).toBe(true);
    const link = buildPaymentLink({ ...validInput, amount });
    expect(paymentAmountFromUrl(link.url)).toBe("0.020000");
  });

  it("refuses a price that is not a whole number of micro-USD units", () => {
    const priceUsd = 1 / MICRO_USD_PER_USD / 2;
    expect(() => catalogPriceToPaymentAmount(priceUsd)).toThrow(InvalidPaymentLinkError);
  });

  it("refuses non-finite prices", () => {
    expect(() => catalogPriceToPaymentAmount(Number.NaN)).toThrow(InvalidPaymentLinkError);
    expect(() => catalogPriceToPaymentAmount(Number.POSITIVE_INFINITY)).toThrow(
      InvalidPaymentLinkError
    );
  });

  it("round-trips a link amount back to its catalog price", () => {
    const priceUsd = 0.03;
    const link = buildPaymentLink({
      ...validInput,
      amount: catalogPriceToPaymentAmount(priceUsd)
    });
    expect(link.amount / MICRO_USD_PER_USD).toBe(priceUsd);
  });
});
