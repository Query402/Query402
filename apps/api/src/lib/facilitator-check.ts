import { config } from "./config.js";
import { getProviderById } from "./pricing.js";

export const PRICED_ASSET = "USDC";

export class FacilitatorPaymentError extends Error {
  constructor() {
    super("payment_not_confirmed");
    this.name = "FacilitatorPaymentError";
  }
}

export interface FacilitatorPaymentResult {
  asset?: string;
  amount?: string;
  destination?: string;
  secret?: string;
}

export function pricedPaymentForProvider(providerId: string) {
  const provider = getProviderById(providerId);
  const destination = config.X402_PAY_TO_ADDRESS ?? "";
  if (!provider || !destination) {
    throw new FacilitatorPaymentError();
  }

  return {
    asset: PRICED_ASSET,
    amount: provider.priceUsd.toString(),
    destination
  };
}

export function assertFacilitatorConfirmsPrice(input: {
  providerId: string;
  facilitatorResult: FacilitatorPaymentResult | null;
}): void {
  const priced = pricedPaymentForProvider(input.providerId);
  const result = input.facilitatorResult;
  if (!result?.asset || result.amount === undefined || result.amount === "" || !result.destination) {
    throw new FacilitatorPaymentError();
  }

  const paid = Number(result.amount);
  const expected = Number(priced.amount);
  if (
    result.asset !== priced.asset ||
    result.destination !== priced.destination ||
    !Number.isFinite(paid) ||
    paid !== expected
  ) {
    throw new FacilitatorPaymentError();
  }
}

export function runProviderAfterConfirmation<T>(input: {
  providerId: string;
  facilitatorResult: FacilitatorPaymentResult | null;
  run: () => T;
}): T {
  assertFacilitatorConfirmsPrice({
    providerId: input.providerId,
    facilitatorResult: input.facilitatorResult
  });
  return input.run();
}

interface FacilitatorCheckResult {
  ok: boolean;
  checkedAt: string;
  error?: string;
}

let cachedResult: FacilitatorCheckResult | null = null;
let cachedAt: number = 0;
let pendingCheck: Promise<FacilitatorCheckResult> | null = null;

const CACHE_TTL_MS = 30_000;

export async function checkFacilitatorSupported(): Promise<FacilitatorCheckResult> {
  const now = Date.now();

  if (cachedResult && now - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }

  if (pendingCheck) {
    return pendingCheck;
  }

  if (config.demoMode || !config.X402_FACILITATOR_API_KEY) {
    cachedResult = { ok: false, checkedAt: new Date().toISOString() };
    cachedAt = now;
    return cachedResult;
  }

  pendingCheck = performCheck();

  try {
    cachedResult = await pendingCheck;
    cachedAt = now;
    return cachedResult;
  } finally {
    pendingCheck = null;
  }
}

async function performCheck(): Promise<FacilitatorCheckResult> {
  try {
    const controller = new AbortController();
    const timeoutMs = 5000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${config.X402_FACILITATOR_URL.replace(/\/+$/, "")}/supported`, {
      method: "GET",
      signal: controller.signal,
      headers: config.X402_FACILITATOR_API_KEY
        ? { Authorization: `Bearer ${config.X402_FACILITATOR_API_KEY}` }
        : undefined
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        error: `HTTP ${response.status}`
      };
    }

    return { ok: true, checkedAt: new Date().toISOString() };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? "timeout"
          : error.message
        : String(error);

    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      error: message
    };
  }
}

export function clearFacilitatorCache(): void {
  cachedResult = null;
  cachedAt = 0;
  pendingCheck = null;
}
