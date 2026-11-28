/**
 * Settlement rails Query402 can offer alongside the existing x402 flow.
 *
 * `x402-stellar` remains the Stellar/USDC rail and still uses `buildPaymentLink`.
 * `nano` is an additional feeless option. This module only selects the rail and
 * checks a caller-supplied raw amount and account. It does not broadcast a
 * block, contact a representative, or convert a USD catalog price into XNO.
 */

export type SettlementRail = "x402-stellar" | "nano";

export interface SettlementOption {
  rail: SettlementRail;
  asset: "USDC" | "XNO";
  fee: "stellar-network" | "none";
  summary: string;
}

export const SETTLEMENT_OPTIONS: readonly SettlementOption[] = [
  {
    rail: "x402-stellar",
    asset: "USDC",
    fee: "stellar-network",
    summary:
      "Existing x402 settlement on Stellar. Catalog prices stay integer micro-USD amounts and use the Stellar payment link."
  },
  {
    rail: "nano",
    asset: "XNO",
    fee: "none",
    summary:
      "Additional Nano settlement. The caller supplies an integer raw amount and a nano_ account. There is no network fee and no USD conversion."
  }
];

/** 1 XNO = 10^30 raw. One million XNO is the largest instruction this helper accepts. */
export const MAX_NANO_RAW = 10n ** 36n;

const NANO_ACCOUNT_PATTERN = /^nano_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/;
const HEX_SEED_PATTERN = /^[0-9a-fA-F]{64}$/;

export class SettlementInputError extends Error {
  readonly code = "invalid_settlement" as const;

  constructor(message: string) {
    super(message);
    this.name = "SettlementInputError";
  }
}

export interface NanoSettlementInstruction {
  rail: "nano";
  asset: "XNO";
  amountRaw: string;
  destination: string;
  feeRaw: "0";
  stellarPaymentLink: null;
}

export function settlementOptionForAsset(asset: string): SettlementOption {
  const match = SETTLEMENT_OPTIONS.find((option) => option.asset === asset);
  if (!match) {
    throw new SettlementInputError("Settlement asset must be USDC or XNO.");
  }
  return match;
}

/**
 * Describe a Nano payment without leaving the process. The raw amount is a
 * decimal integer string so it cannot be rounded through a JavaScript number.
 */
export function buildNanoSettlement(input: {
  amountRaw: string;
  destination: string;
}): NanoSettlementInstruction {
  const amountRaw = parseNanoRaw(input.amountRaw);
  const destination = parseNanoAccount(input.destination);

  return {
    rail: "nano",
    asset: "XNO",
    amountRaw,
    destination,
    feeRaw: "0",
    stellarPaymentLink: null
  };
}

function parseNanoRaw(amountRaw: string): string {
  if (typeof amountRaw !== "string" || !/^[1-9][0-9]*$/.test(amountRaw)) {
    throw new SettlementInputError("Nano amount must be a positive integer raw value.");
  }

  const raw = BigInt(amountRaw);
  if (raw > MAX_NANO_RAW) {
    throw new SettlementInputError("Nano amount exceeds the accepted raw limit.");
  }

  return raw.toString();
}

function parseNanoAccount(destination: string): string {
  if (typeof destination !== "string") {
    throw new SettlementInputError("Nano account is missing.");
  }

  const account = destination.trim();
  if (HEX_SEED_PATTERN.test(account) || account.startsWith("S") || account.startsWith("G")) {
    throw new SettlementInputError("Nano settlement does not accept a seed or a Stellar address.");
  }

  if (!NANO_ACCOUNT_PATTERN.test(account)) {
    throw new SettlementInputError("Nano account must be a nano_ address.");
  }

  return account;
}
