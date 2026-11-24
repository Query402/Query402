import {
  paymentChallengeSchema,
  quoteBindErrorCodeSchema,
  requestedQuoteSchema,
  type PaymentChallenge,
  type QuoteBindErrorCode,
  type RequestedQuote
} from "@query402/shared";
import { convertToTokenAmount, getUsdcAddress } from "@x402/stellar";

export type { PaymentChallenge, QuoteBindErrorCode, RequestedQuote };

/**
 * Typed quote-bind failure. Never carries the raw PAYMENT-REQUIRED header.
 */
export class QuoteBindError extends Error {
  readonly code: QuoteBindErrorCode;

  constructor(code: QuoteBindErrorCode, message: string) {
    super(message);
    this.name = "QuoteBindError";
    this.code = quoteBindErrorCodeSchema.parse(code);
  }
}

export function buildRequestedQuote(input: {
  provider: string;
  priceUsd: number;
  network: string;
  asset?: string;
}): RequestedQuote {
  const asset = input.asset ?? getUsdcAddress(input.network as `${string}:${string}`);
  const amount = convertToTokenAmount(input.priceUsd.toFixed(7));
  return requestedQuoteSchema.parse({
    provider: input.provider,
    amount,
    asset,
    network: input.network
  });
}

/**
 * Pull a comparable challenge record from an x402 PaymentRequired accepts entry.
 * Provider / expiry may live on the accept itself or under `extra`.
 */
export function extractPaymentChallenge(
  accept: Record<string, unknown> | null | undefined
): PaymentChallenge | null {
  if (!accept || typeof accept !== "object") {
    return null;
  }

  const extra =
    accept.extra && typeof accept.extra === "object"
      ? (accept.extra as Record<string, unknown>)
      : {};

  const provider =
    (typeof accept.provider === "string" && accept.provider) ||
    (typeof extra.provider === "string" && extra.provider) ||
    undefined;
  const amount =
    (typeof accept.amount === "string" && accept.amount) ||
    (typeof accept.maxAmountRequired === "string" && accept.maxAmountRequired) ||
    undefined;
  const asset = typeof accept.asset === "string" ? accept.asset : undefined;
  const network = typeof accept.network === "string" ? accept.network : undefined;
  const expiresAt =
    (typeof accept.expiresAt === "string" && accept.expiresAt) ||
    (typeof extra.expiresAt === "string" && extra.expiresAt) ||
    undefined;

  if (!provider || !amount || !asset || !network) {
    return null;
  }

  const parsed = paymentChallengeSchema.safeParse({
    provider,
    amount,
    asset,
    network,
    expiresAt
  });
  return parsed.success ? parsed.data : null;
}

export function extractChallengeFromPaymentRequired(
  paymentRequired: unknown
): PaymentChallenge | null {
  if (!paymentRequired || typeof paymentRequired !== "object") {
    return null;
  }

  const accepts = (paymentRequired as { accepts?: unknown }).accepts;
  const first = Array.isArray(accepts)
    ? (accepts[0] as Record<string, unknown> | undefined)
    : accepts && typeof accepts === "object"
      ? (accepts as Record<string, unknown>)
      : undefined;

  return extractPaymentChallenge(first);
}

/**
 * Compare a 402 challenge to the quote the client requested.
 * Throws QuoteBindError on empty, expired, or mismatched challenges.
 */
export function assertChallengeMatchesQuote(
  quote: RequestedQuote,
  challenge: PaymentChallenge | null | undefined,
  nowMs: number = Date.now()
): void {
  const expected = requestedQuoteSchema.parse(quote);

  if (!challenge) {
    throw new QuoteBindError(
      "challenge_empty",
      "Payment challenge is empty or incomplete; refusing to sign"
    );
  }

  if (challenge.expiresAt) {
    const expiresMs = Date.parse(challenge.expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
      throw new QuoteBindError(
        "challenge_expired",
        "Payment challenge has expired; refusing to sign"
      );
    }
  }

  if (
    challenge.provider !== expected.provider ||
    challenge.amount !== expected.amount ||
    challenge.asset !== expected.asset ||
    challenge.network !== expected.network
  ) {
    throw new QuoteBindError(
      "challenge_mismatch",
      "Payment challenge does not match the requested quote; refusing to sign"
    );
  }
}
