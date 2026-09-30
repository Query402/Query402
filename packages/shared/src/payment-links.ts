import type { z } from "zod";
import { MICRO_USD_PER_USD, paymentLinkInputSchema, type PaymentLinkInput } from "./schemas.js";

const STELLAR_TESTNET_EXPLORER = "https://stellar.expert/explorer/testnet";
const STELLAR_PUBNET_EXPLORER = "https://stellar.expert/explorer/public";

/**
 * A payment link could not be built because the inputs failed the shared
 * payment-link schema. The message quotes only caller-provided payment
 * metadata — never a secret — so it is safe to return to clients or logs.
 */
export class InvalidPaymentLinkError extends Error {
  readonly code = "invalid_payment_link" as const;
  readonly issues: PaymentLinkIssue[];

  constructor(issues: PaymentLinkIssue[]) {
    super(
      `Payment link rejected: ${issues.map((issue) => `${issue.field} ${issue.message}`).join("; ")}`
    );
    this.name = "InvalidPaymentLinkError";
    this.issues = issues;
  }
}

export interface PaymentLinkIssue {
  field: keyof PaymentLinkInput;
  message: string;
}

export interface PaymentLink {
  url: string;
  amount: number;
  asset: string;
  destination: string;
  network: string;
}

/**
 * Map a zod failure to schema-ordered, secret-free issues. Zod reports issues
 * in field order for object schemas, but sorting keeps that guarantee
 * explicit even if the input shape or zod internals change.
 */
function toPaymentLinkIssues(error: z.ZodError): PaymentLinkIssue[] {
  const fieldOrder: Array<keyof PaymentLinkInput> = ["amount", "asset", "destination", "network"];
  const rank = new Map(fieldOrder.map((field, index) => [field, index]));
  return error.issues
    .map((issue) => ({
      field: (issue.path[0] ?? "amount") as keyof PaymentLinkInput,
      message: issue.message
    }))
    .sort((a, b) => (rank.get(a.field) ?? 0) - (rank.get(b.field) ?? 0));
}

function formatMicroUsd(amountMicroUsd: number): string {
  const dollars = Math.floor(amountMicroUsd / MICRO_USD_PER_USD);
  const micros = amountMicroUsd % MICRO_USD_PER_USD;
  return `${dollars}.${String(micros).padStart(6, "0")}`;
}

/**
 * Build a Stellar expert payment link for an exact-scheme x402 payment, but
 * only when the amount, asset, destination, and network validate against the
 * shared payment-link schema. The amount is the catalog price expressed as an
 * integer number of micro-USD units — never a floating-point value — so a
 * client can never open a payment for an amount other than the catalog price.
 *
 * The link and the error message contain only payment metadata; no secret or
 * credential is ever embedded.
 */
export function buildPaymentLink(input: unknown): PaymentLink {
  const parsed = paymentLinkInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidPaymentLinkError(toPaymentLinkIssues(parsed.error));
  }

  const { amount, asset, destination, network } = parsed.data;
  const params = new URLSearchParams({
    amount: formatMicroUsd(amount),
    asset,
    destination,
    network
  });

  const networkSlug = network.startsWith("stellar:pubnet") ? "public" : "testnet";
  const base = networkSlug === "public" ? STELLAR_PUBNET_EXPLORER : STELLAR_TESTNET_EXPLORER;

  return {
    url: `${base}/payment?${params.toString()}`,
    amount,
    asset,
    destination,
    network
  };
}

/**
 * Convert a USD catalog price to an integer micro-USD amount, refusing any
 * price that is not representable in whole micro-USD units. This is the only
 * sanctioned way to feed a catalog price into {@link buildPaymentLink}.
 */
export function catalogPriceToPaymentAmount(priceUsd: number): number {
  const amount = priceUsd * MICRO_USD_PER_USD;
  if (!Number.isInteger(amount)) {
    throw new InvalidPaymentLinkError([
      {
        field: "amount",
        message: `must be a whole number of micro-USD units at ${MICRO_USD_PER_USD} per USD`
      }
    ]);
  }
  return amount;
}

export function resolveStellarExplorerUrl(network?: string): string {
  if (!network) {
    return STELLAR_TESTNET_EXPLORER;
  }
  const normalized = network.toLowerCase();
  if (normalized.includes("test") || normalized.includes("testnet")) {
    return STELLAR_TESTNET_EXPLORER;
  }
  if (
    normalized.includes("pub") ||
    normalized.includes("main") ||
    normalized === "stellar:pubnet"
  ) {
    return STELLAR_PUBNET_EXPLORER;
  }
  return STELLAR_TESTNET_EXPLORER;
}

export function buildTransactionLink(txHash: string, network?: string): string {
  const base = resolveStellarExplorerUrl(network);
  return `${base}/tx/${txHash}`;
}

export function buildAccountLink(publicKey: string, network?: string): string {
  const base = resolveStellarExplorerUrl(network);
  return `${base}/account/${publicKey}`;
}

export interface PaymentProofLinks {
  transaction: string | "not_available";
  payer: string | "not_available";
  payTo: string | "not_available";
  network: string;
  asset: string | "not_available";
}

export function buildPaymentProofLinks(input: {
  transactionHash?: string;
  payerPublicKey?: string;
  payToAddress?: string;
  network?: string;
  asset?: string;
}): PaymentProofLinks {
  return {
    transaction: input.transactionHash
      ? buildTransactionLink(input.transactionHash, input.network)
      : "not_available",
    payer: input.payerPublicKey
      ? buildAccountLink(input.payerPublicKey, input.network)
      : "not_available",
    payTo: input.payToAddress
      ? buildAccountLink(input.payToAddress, input.network)
      : "not_available",
    network: input.network ?? "unknown",
    asset: input.asset ?? "not_available"
  };
}
