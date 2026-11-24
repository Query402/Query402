import { describe, expect, it } from "vitest";
import {
  buildNanoSettlement,
  MAX_NANO_RAW,
  SETTLEMENT_OPTIONS,
  SettlementInputError,
  settlementOptionForAsset
} from "./settlement-options.js";

const NANO_ACCOUNT = `nano_3${"13456789abcdefghijkmnopqrstuwxyz".repeat(3).slice(0, 59)}`;
const STELLAR_SECRET = `S${"A".repeat(55)}`;

describe("settlement options", () => {
  it("offers Stellar x402 and Nano side by side", () => {
    expect(SETTLEMENT_OPTIONS.map((option) => option.rail)).toEqual(["x402-stellar", "nano"]);
    expect(settlementOptionForAsset("USDC").fee).toBe("stellar-network");
    expect(settlementOptionForAsset("XNO")).toMatchObject({
      rail: "nano",
      asset: "XNO",
      fee: "none"
    });
  });

  it("rejects an asset that is neither rail", () => {
    expect(() => settlementOptionForAsset("BTC")).toThrow(SettlementInputError);
  });
});

describe("buildNanoSettlement", () => {
  it("records a feeless raw transfer and does not build a Stellar link", () => {
    const instruction = buildNanoSettlement({
      amountRaw: "1000000000000000000000000000000",
      destination: NANO_ACCOUNT
    });

    expect(instruction).toEqual({
      rail: "nano",
      asset: "XNO",
      amountRaw: "1000000000000000000000000000000",
      destination: NANO_ACCOUNT,
      feeRaw: "0",
      stellarPaymentLink: null
    });
    expect(JSON.stringify(instruction)).not.toContain("stellar.expert");
    expect(JSON.stringify(instruction)).not.toContain(STELLAR_SECRET);
  });

  it("keeps the raw amount as an integer string", () => {
    const instruction = buildNanoSettlement({
      amountRaw: MAX_NANO_RAW.toString(),
      destination: NANO_ACCOUNT
    });
    expect(instruction.amountRaw).toBe(MAX_NANO_RAW.toString());
  });

  it("rejects decimals, zero, and amounts above the raw cap", () => {
    for (const amountRaw of ["1.5", "0", "01", "-1", "1e30", ""]) {
      expect(() => buildNanoSettlement({ amountRaw, destination: NANO_ACCOUNT })).toThrow(
        SettlementInputError
      );
    }
    expect(() =>
      buildNanoSettlement({ amountRaw: (MAX_NANO_RAW + 1n).toString(), destination: NANO_ACCOUNT })
    ).toThrow(/raw limit/);
  });

  it("rejects seeds and Stellar addresses", () => {
    const seed = "a".repeat(64);
    expect(() => buildNanoSettlement({ amountRaw: "1", destination: seed })).toThrow(/seed/);
    expect(() =>
      buildNanoSettlement({ amountRaw: "1", destination: `G${"A".repeat(55)}` })
    ).toThrow(/Stellar/);
    expect(() => buildNanoSettlement({ amountRaw: "1", destination: "nano_short" })).toThrow(
      /nano_ address/
    );
  });
});
