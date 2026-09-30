import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequired } from "@x402/core/types";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { createEd25519Signer, getUsdcAddress } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { buildPaymentProofLinks } from "@query402/shared";
import type { PaymentProofLinks } from "@query402/shared";
import { nanoid } from "nanoid";
import { validateChallengeAgainstConfig, type ChallengeMismatch } from "./challenge.js";
import { config } from "./config.js";
import { buildPaidClientRequestKey, getIdempotencyKey } from "./idempotency.js";
import {
  assertChallengeMatchesQuote,
  buildRequestedQuote,
  extractChallengeFromPaymentRequired,
  QuoteBindError,
  type RequestedQuote
} from "./quote-bind.js";

export { QuoteBindError, buildRequestedQuote, assertChallengeMatchesQuote };
export type { RequestedQuote };

export class ChallengeMismatchError extends Error {
  readonly name = "ChallengeMismatchError";
  constructor(public readonly mismatch: ChallengeMismatch) {
    super(
      `402 challenge ${mismatch.field} mismatch: expected ${mismatch.expected}, got ${mismatch.actual}. Payment NOT signed.`
    );
  }
}

/**
 * Fetch the 402 challenge and compare it to the CLI's own configuration
 * BEFORE any signing happens. Throws ChallengeMismatchError when the
 * server's provider/network/asset/amount disagrees with the config; the
 * signer is never constructed on that path.
 */
export async function fetchValidatedChallenge(endpoint: string): Promise<PaymentRequired> {
  const probe = await fetch(endpoint, { method: "GET" });
  if (probe.status !== 402) {
    throw new Error(`Expected a 402 challenge from ${endpoint} but got status ${probe.status}.`);
  }

  const header = probe.headers.get("payment-required");
  let challenge: PaymentRequired;
  if (header) {
    challenge = decodePaymentRequiredHeader(header);
  } else {
    // Some deployments inline the v1 challenge in the JSON body instead.
    const body = (await probe.json().catch(() => null)) as {
      x402Version?: number;
      accepts?: unknown;
    } | null;
    if (!body || typeof body.x402Version !== "number" || !Array.isArray(body.accepts)) {
      throw new Error("402 response carried no parsable payment challenge.");
    }
    challenge = body as unknown as PaymentRequired;
  }

  const validation = validateChallengeAgainstConfig(
    challenge,
    {
      provider: new URL(endpoint).searchParams.get("provider") ?? "",
      network: config.STELLAR_NETWORK,
      asset: config.X402_ASSET,
      maxPriceUsd: config.X402_MAX_PRICE_USD
    },
    endpoint
  );

  if (!validation.ok) {
    throw new ChallengeMismatchError(validation.mismatch);
  }

  return challenge;
}

export function buildPaidQueryEndpoint(input: {
  mode: "search" | "news" | "scrape";
  provider: string;
  query?: string;
  url?: string;
  apiBaseUrl?: string;
}) {
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

  const baseUrl = input.apiBaseUrl ?? config.API_BASE_URL;
  return `${baseUrl}/x402/${input.mode}?${params.toString()}`;
}

function isNetworkFailure(error: unknown) {
  return error instanceof TypeError || error instanceof DOMException;
}

function formatNetworkFailure(error: unknown, apiBaseUrl: string) {
  const detail = error instanceof Error && error.message ? ` Details: ${error.message}` : "";
  return `Unable to reach Query402 API at ${apiBaseUrl}. Check API_BASE_URL and confirm the API server is running.${detail}`;
}

export type WalletSigner = {
  address: string;
  signAuthEntry: (...args: unknown[]) => Promise<unknown>;
  signTransaction?: (...args: unknown[]) => Promise<unknown>;
};

export type RunPaidQueryDeps = {
  fetch?: typeof fetch;
  /** Optional pre-resolved quote; when omitted the catalog is fetched. */
  quote?: RequestedQuote;
  /** Injectable wallet factory for tests (avoids live signing). */
  createWallet?: (secretKey: string, network: string) => WalletSigner;
  /**
   * Injectable payment-header factory invoked only after the challenge matches
   * the requested quote. Tests stub this instead of a live wallet.
   */
  createPaymentHeaders?: (
    paymentRequired: unknown,
    quote: RequestedQuote
  ) => Promise<Record<string, string>>;
  nowMs?: number;
};

async function resolveQuoteFromCatalog(
  provider: string,
  fetchFn: typeof fetch,
  apiBaseUrl: string
): Promise<RequestedQuote> {
  const response = await fetchFn(`${apiBaseUrl}/api/providers`);
  if (!response.ok) {
    throw new Error(`Unable to load provider catalog (status ${response.status})`);
  }
  const body = (await response.json()) as {
    providers?: Array<{ id: string; priceUsd: number; enabled?: boolean }>;
  };
  const match = body.providers?.find((p) => p.id === provider && p.enabled !== false);
  if (!match) {
    throw new Error(`Provider "${provider}" was not found in the catalog`);
  }

  const network = config.STELLAR_NETWORK;
  const asset = config.X402_ASSET ?? getUsdcAddress(network as `${string}:${string}`);
  return buildRequestedQuote({
    provider: match.id,
    priceUsd: match.priceUsd,
    network,
    asset
  });
}

/**
 * Fetch with quote-bound x402 payment: only signs when the 402 challenge
 * matches the requested quote (provider, amount, asset, network) and is fresh.
 */
export async function fetchWithQuoteBoundPayment(
  endpoint: string,
  init: RequestInit,
  quote: RequestedQuote,
  options: {
    fetch?: typeof fetch;
    client: x402Client;
    createPaymentHeaders?: RunPaidQueryDeps["createPaymentHeaders"];
    nowMs?: number;
  }
): Promise<Response> {
  const fetchFn = options.fetch ?? fetch;
  const httpClient = new x402HTTPClient(options.client);

  const firstResponse = await fetchFn(endpoint, init);
  if (firstResponse.status !== 402) {
    return firstResponse;
  }

  let paymentRequired: unknown;
  try {
    const getHeader = (name: string) => firstResponse.headers.get(name);
    let body: unknown;
    try {
      const text = await firstResponse.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch {
      // Header-only challenges are valid.
    }
    paymentRequired = httpClient.getPaymentRequiredResponse(getHeader, body);
  } catch {
    throw new QuoteBindError(
      "challenge_empty",
      "Payment challenge is empty or incomplete; refusing to sign"
    );
  }

  const challenge = extractChallengeFromPaymentRequired(paymentRequired);
  assertChallengeMatchesQuote(quote, challenge, options.nowMs ?? Date.now());

  let paymentHeaders: Record<string, string>;
  if (options.createPaymentHeaders) {
    paymentHeaders = await options.createPaymentHeaders(paymentRequired, quote);
  } else {
    const paymentPayload = await options.client.createPaymentPayload(
      paymentRequired as Parameters<x402Client["createPaymentPayload"]>[0]
    );
    paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
  }

  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(paymentHeaders)) {
    headers.set(key, value);
  }

  return fetchFn(endpoint, {
    ...init,
    headers
  });
}

export async function runPaidQuery(
  input: {
    mode: "search" | "news" | "scrape";
    provider: string;
    query?: string;
    url?: string;
  },
  deps: RunPaidQueryDeps = {}
) {
  const fetchFn = deps.fetch ?? fetch;
  const endpoint = buildPaidQueryEndpoint(input);
  const apiBaseUrl = config.API_BASE_URL;
  const isDemoMode = config.DEMO_MODE === "true";

  if (!isDemoMode && !config.DEMO_CLIENT_SECRET_KEY && !deps.createPaymentHeaders) {
    throw new Error("DEMO_CLIENT_SECRET_KEY is required when DEMO_MODE is false");
  }

  let quote: RequestedQuote | undefined = deps.quote;
  if (!isDemoMode && !quote) {
    try {
      quote = await resolveQuoteFromCatalog(input.provider, fetchFn, apiBaseUrl);
    } catch (error) {
      if (isNetworkFailure(error)) {
        throw new Error(formatNetworkFailure(error, apiBaseUrl), { cause: error });
      }
      throw error;
    }
  }

  const idempotencyKey = getIdempotencyKey(
    buildPaidClientRequestKey({
      route: `/x402/${input.mode}`,
      mode: input.mode,
      provider: input.provider,
      query: input.query,
      url: input.url,
      payer: config.DEMO_CLIENT_PUBLIC_KEY ?? "agent-client",
      amount: quote?.amount,
      asset: quote?.asset,
      network: quote?.network
    })
  );

  let response: Response;
  try {
    response = isDemoMode
      ? await fetchFn(endpoint, {
          method: "GET",
          headers: {
            "x-query402-demo-paid": "true",
            "payment-response": `demo_tx_${nanoid(10)}`,
            "Idempotency-Key": idempotencyKey
          }
        })
      : await (async () => {
          if (!quote) {
            throw new QuoteBindError(
              "challenge_empty",
              "Payment challenge is empty or incomplete; refusing to sign"
            );
          }

          const network = config.STELLAR_NETWORK;
          const secretKey = config.DEMO_CLIENT_SECRET_KEY;
          if (!secretKey && !deps.createWallet && !deps.createPaymentHeaders) {
            throw new Error("DEMO_CLIENT_SECRET_KEY is required when DEMO_MODE is false");
          }

          // Issue #176: compare the 402 challenge to this CLI's configuration
          // BEFORE asking for a signature. This fetches and validates the
          // challenge; on mismatch it throws and the signer below is never
          // constructed.
          await fetchValidatedChallenge(endpoint);

          const wallet = deps.createWallet
            ? deps.createWallet(secretKey ?? "test-secret", network)
            : createEd25519Signer(secretKey!, network as `${string}:${string}`);

          const client = new x402Client().register(
            "stellar:*",
            new ExactStellarScheme(wallet as never, { url: config.STELLAR_RPC_URL })
          );

          return fetchWithQuoteBoundPayment(
            endpoint,
            {
              method: "GET",
              headers: {
                "Idempotency-Key": idempotencyKey
              }
            },
            quote,
            {
              fetch: fetchFn,
              client,
              createPaymentHeaders: deps.createPaymentHeaders,
              nowMs: deps.nowMs
            }
          );
        })();
  } catch (error) {
    if (error instanceof QuoteBindError) {
      throw error;
    }
    if (isNetworkFailure(error)) {
      throw new Error(formatNetworkFailure(error, apiBaseUrl), { cause: error });
    }
    throw error;
  }

  const json = await response.json();
  if (!response.ok || response.status === 402) {
    if (json && typeof json === "object" && !json.errorCode) {
      json.errorCode = response.status === 402 ? "payment_required" : "internal_error";
    }
  }

  const evidence = json?.payment?.evidence as
    | {
        transactionHash?: string;
        payer?: string;
        payTo?: string;
        network?: string;
        asset?: string;
      }
    | undefined;

  const proofLinks: PaymentProofLinks | undefined = evidence
    ? buildPaymentProofLinks({
        transactionHash: evidence.transactionHash,
        payerPublicKey: evidence.payer,
        payToAddress: evidence.payTo,
        network: evidence.network,
        asset: evidence.asset ?? undefined
      })
    : undefined;

  return {
    endpoint,
    status: response.status,
    ok: response.ok,
    isDemoMode,
    paymentResponse: response.headers.get("payment-response"),
    id: idempotencyKey,
    body: json,
    proofLinks,
    quote
  };
}
