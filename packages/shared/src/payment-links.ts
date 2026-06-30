export const STELLAR_TESTNET_EXPLORER = "https://stellar.expert/explorer/testnet";

export function buildTransactionLink(txHash: string): string {
  return `${STELLAR_TESTNET_EXPLORER}/tx/${txHash}`;
}

export function buildAccountLink(publicKey: string): string {
  return `${STELLAR_TESTNET_EXPLORER}/account/${publicKey}`;
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
      ? buildTransactionLink(input.transactionHash)
      : "not_available",
    payer: input.payerPublicKey ? buildAccountLink(input.payerPublicKey) : "not_available",
    payTo: input.payToAddress ? buildAccountLink(input.payToAddress) : "not_available",
    network: input.network ?? "unknown",
    asset: input.asset ?? "not_available"
  };
}
