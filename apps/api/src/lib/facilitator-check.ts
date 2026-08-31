import { config } from "./config.js";

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
