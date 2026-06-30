import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { buildPaidClientRequestKey, getIdempotencyKey } from "./idempotency.js";

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

export async function runPaidQuery(input: {
  mode: "search" | "news" | "scrape";
  provider: string;
  query?: string;
  url?: string;
}) {
  const endpoint = buildPaidQueryEndpoint(input);
  const apiBaseUrl = config.API_BASE_URL;
  const idempotencyKey = getIdempotencyKey(
    buildPaidClientRequestKey({
      route: `/x402/${input.mode}`,
      mode: input.mode,
      provider: input.provider,
      query: input.query,
      url: input.url,
      payer: config.DEMO_CLIENT_PUBLIC_KEY ?? "agent-client"
    })
  );
  const isDemoMode = config.DEMO_MODE === "true";

  let response: Response;
  try {
    response = isDemoMode
      ? await fetch(endpoint, {
          method: "GET",
          headers: {
            "x-query402-demo-paid": "true",
            "payment-response": `demo_tx_${nanoid(10)}`,
            "Idempotency-Key": idempotencyKey
          }
        })
      : await (async () => {
          if (!config.DEMO_CLIENT_SECRET_KEY) {
            throw new Error("DEMO_CLIENT_SECRET_KEY is required when DEMO_MODE is false");
          }

          const signer = createEd25519Signer(
            config.DEMO_CLIENT_SECRET_KEY,
            config.STELLAR_NETWORK as `${string}:${string}`
          );

          const client = new x402Client().register(
            "stellar:*",
            new ExactStellarScheme(signer, { url: config.STELLAR_RPC_URL })
          );

          const fetchWithPayment = wrapFetchWithPayment(fetch, client);
          return fetchWithPayment(endpoint, {
            method: "GET",
            headers: {
              "Idempotency-Key": idempotencyKey
            }
          });
        })();
  } catch (error) {
    if (isNetworkFailure(error)) {
      throw new Error(formatNetworkFailure(error, apiBaseUrl), { cause: error });
    }
    throw error;
  }

  const json = await response.json();

  return {
    endpoint,
    status: response.status,
    ok: response.ok,
    paymentResponse: response.headers.get("payment-response"),
    isDemoMode,
    body: json
  };
}
