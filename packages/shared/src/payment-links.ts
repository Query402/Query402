const STELLAR_TESTNET_EXPLORER = "https://stellar.expert/explorer/testnet";
const STELLAR_PUBNET_EXPLORER = "https://stellar.expert/explorer/public";

export function resolveStellarExplorerUrl(network?: string): string {
  if (!network) {
    return STELLAR_TESTNET_EXPLORER;
  }
  const normalized = network.toLowerCase();
  if (normalized.includes("test") || normalized.includes("testnet")) {
    return STELLAR_TESTNET_EXPLORER;
  }
  if (normalized.includes("pub") || normalized.includes("main") || normalized === "stellar:pubnet") {
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
    payer: input.payerPublicKey ? buildAccountLink(input.payerPublicKey) : "not_available",
    payTo: input.payToAddress ? buildAccountLink(input.payToAddress) : "not_available",
    network: input.network ?? "unknown",
    asset: input.asset ?? "not_available"
  };
}
