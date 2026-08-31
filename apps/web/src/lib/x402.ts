import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import type { ClientStellarSigner } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { buildPaymentProofLinks } from "@query402/shared";
import type { PaidQueryResponse } from "../types.js";
import { getIdempotencyKey, buildPaidClientRequestKey } from "./idempotency.js";

const stellarRpcUrl = import.meta.env.VITE_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

function createMachineSigner(
  wallet: import("./wallet/index.js").WalletSessionMachine
): ClientStellarSigner {
  return {
    address: wallet.getState().address!,
    signAuthEntry: async (authEntryXdr, opts) => {
      const res = await wallet.signAuthEntry(authEntryXdr, opts);
      return res;
    },
    signTransaction: async (transactionXdr, opts) => {
      const res = await wallet.signTransaction(transactionXdr, opts);
      return res;
    }
  };
}

function enrichWithProofLinks(payload: PaidQueryResponse): PaidQueryResponse {
  if (payload?.payment?.evidence) {
    const ev = payload.payment.evidence;
    if (!ev.proofLinks) {
      ev.proofLinks = buildPaymentProofLinks({
        transactionHash: ev.transactionHash,
        payerPublicKey: ev.payer,
        payToAddress: ev.payTo,
        network: ev.network,
        asset: ev.asset ?? undefined
      });
    }
  }
  return payload;
}

export async function runWalletPaidQuery(input: {
  apiBaseUrl: string;
  mode: "search" | "news" | "scrape";
  provider: string;
  query?: string;
  url?: string;
  wallet: import("./wallet/index.js").WalletSessionMachine;
}): Promise<PaidQueryResponse> {
  const params = new URLSearchParams({ provider: input.provider });

  if (input.mode === "scrape") {
    if (!input.url) {
      throw new Error("url is required for scrape mode");
    }
    params.set("url", input.url);
  } else {
    if (!input.query) {
      throw new Error("query is required for search/news mode");
    }
    params.set("q", input.query);
  }

  const endpoint = `${input.apiBaseUrl}/x402/${input.mode}?${params.toString()}`;
  const walletAddress = input.wallet.getState().address;
  if (!walletAddress) {
    throw new Error("Wallet is not connected");
  }

  const idempotencyKey = getIdempotencyKey(
    buildPaidClientRequestKey({
      route: `/x402/${input.mode}`,
      mode: input.mode,
      provider: input.provider,
      query: input.query,
      url: input.url,
      payer: walletAddress
    })
  );

  const signer = createMachineSigner(input.wallet);
  const client = new x402Client().register(
    "stellar:*",
    new ExactStellarScheme(signer, { url: stellarRpcUrl })
  );
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const response = await fetchWithPayment(endpoint, {
    method: "GET",
    headers: {
      "Idempotency-Key": idempotencyKey
    }
  });
  const payload = await response.json();

  if (!response.ok) {
    if (typeof payload?.error === "string" && payload.error.length > 0) {
      throw new Error(payload.error);
    }
    throw new Error(JSON.stringify(payload));
  }

  return enrichWithProofLinks(payload as PaidQueryResponse);
}
