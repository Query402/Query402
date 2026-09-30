// Freighter ships a UMD bundle: under Node's ESM interop the functions live
// on `default`, while Vite exposes them as named exports. Resolve lazily at
// call time so both environments (and node:test) work.
import * as freighterApi from "@stellar/freighter-api";
import type {
  QueryMode,
  SignedGrant,
  SponsorshipChallenge,
  SponsorshipPreview
} from "@query402/shared";
import type { PaidQueryResponse } from "../types.js";
import { fetchJson, paidQueryHeaders } from "./api.js";

type FreighterSignMessage = (
  message: string,
  opts?: { address?: string }
) => Promise<{ signedMessage?: string | Uint8Array | null; error?: unknown }>;

function resolveFreighterSignMessage(): FreighterSignMessage {
  const ns = freighterApi as unknown as {
    signMessage?: FreighterSignMessage;
    default?: { signMessage?: FreighterSignMessage };
  };
  const fn = ns.signMessage ?? ns.default?.signMessage;
  if (!fn) {
    throw new Error("Freighter signMessage is unavailable");
  }
  return fn;
}

function extractFreighterError(error: unknown) {
  if (!error) {
    return "Freighter message signing failed";
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return JSON.stringify(error);
}

function normalizeSignature(signedMessage: string | Uint8Array | null): string {
  if (!signedMessage) {
    throw new Error("Freighter did not return a message signature");
  }

  if (typeof signedMessage === "string") {
    return signedMessage;
  }

  let binary = "";
  signedMessage.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export async function fetchSponsorshipEnabled(apiBaseUrl: string): Promise<boolean> {
  const health = await fetchJson<{ sponsorshipEnabled?: boolean }>(`${apiBaseUrl}/health`);
  return health.sponsorshipEnabled === true;
}

export interface BudgetGateDecision {
  allowed: boolean;
  reason: string | null;
  decision: string | null;
}

/**
 * Evaluate whether a sponsorship preview allows the next paid action.
 * A preview that is not available (budget exhausted or policy deny) blocks the action.
 */
export function evaluateBudgetGate(preview: SponsorshipPreview): BudgetGateDecision {
  if (!preview.available) {
    return {
      allowed: false,
      reason: preview.reason ?? preview.decision,
      decision: preview.decision
    };
  }
  return { allowed: true, reason: null, decision: preview.decision };
}

/**
 * Tracks the budget gate state across async preview requests.
 * A late response for an older budget must not re-enable the actions,
 * so only the latest request's response is applied.
 */
export class BudgetGate {
  private latestRequestId = 0;
  private current: BudgetGateDecision = { allowed: false, reason: null, decision: null };

  beginRequest(): number {
    return ++this.latestRequestId;
  }

  applyResponse(requestId: number, preview: SponsorshipPreview): void {
    if (requestId !== this.latestRequestId) {
      return;
    }
    this.current = evaluateBudgetGate(preview);
  }

  applyError(requestId: number, reason: string): void {
    if (requestId !== this.latestRequestId) {
      return;
    }
    this.current = { allowed: false, reason, decision: null };
  }

  get decision(): BudgetGateDecision {
    return { ...this.current };
  }

  reset(): void {
    this.latestRequestId = 0;
    this.current = { allowed: false, reason: null, decision: null };
  }
}

export async function fetchSponsorshipPreview(input: {
  apiBaseUrl: string;
  wallet: string;
  mode: QueryMode;
  provider: string;
  signal?: AbortSignal;
}): Promise<SponsorshipPreview> {
  return fetchJson<SponsorshipPreview>(`${input.apiBaseUrl}/api/sponsorship/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet: input.wallet,
      mode: input.mode,
      provider: input.provider
    }),
    ...(input.signal ? { signal: input.signal } : {})
  });
}

export async function runSponsoredPaidQuery(input: {
  apiBaseUrl: string;
  mode: QueryMode;
  provider: string;
  query?: string;
  url?: string;
  walletAddress: string;
  /** Test seam: inject a message signer; defaults to the Freighter extension. */
  signMessageFn?: FreighterSignMessage;
}): Promise<PaidQueryResponse> {
  const challenge = await fetchJson<SponsorshipChallenge>(
    `${input.apiBaseUrl}/api/sponsorship/challenge`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: input.walletAddress })
    }
  );

  const signMessage = input.signMessageFn ?? resolveFreighterSignMessage();
  const signResult = await signMessage(challenge.message, { address: input.walletAddress });
  if (signResult.error || !signResult.signedMessage) {
    throw new Error(extractFreighterError(signResult.error));
  }

  const signedGrant = await fetchJson<SignedGrant>(`${input.apiBaseUrl}/api/sponsorship/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet: input.walletAddress,
      challengeId: challenge.challengeId,
      signature: normalizeSignature(signResult.signedMessage)
    })
  });

  const grantHeader = btoa(JSON.stringify(signedGrant));
  const headers = {
    "Content-Type": "application/json",
    "X-Sponsorship-Grant": grantHeader,
    // Key is derived from route + provider + query + grant nonce, and is
    // attached only because /api/paid/run is a protected paid route.
    ...paidQueryHeaders({
      requestUrl: `${input.apiBaseUrl}/api/paid/run`,
      mode: input.mode,
      provider: input.provider,
      query: input.query,
      url: input.url,
      // The single-use grant nonce is the payment reference for the
      // sponsored flow; a different grant never reuses a previous key.
      paymentReference: signedGrant.grant.nonce
    })
  };

  return fetchJson<PaidQueryResponse>(`${input.apiBaseUrl}/api/paid/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      mode: input.mode,
      provider: input.provider,
      wallet: input.walletAddress,
      query: input.query,
      url: input.url
    })
  });
}
