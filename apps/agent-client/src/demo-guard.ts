import { config } from "./config.js";

export class DemoModeDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoModeDisabledError";
  }
}

/** Shape of the subset of GET /health the guard depends on. */
export interface ApiHealthSnapshot {
  demoMode?: boolean;
}

/** Default request timeout for the mode probe, in milliseconds. */
export const DEMO_MODE_PROBE_TIMEOUT_MS = 8_000;

export function isApiDemoModeSnapshot(value: unknown): value is ApiHealthSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  return "demoMode" in value && typeof (value as { demoMode?: unknown }).demoMode === "boolean";
}

export function buildApiHealthUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/health`;
}

/**
 * Reads the demo-mode flag from the API's public health endpoint.
 *
 * Never includes credentials or payment material, and never prints or
 * returns secret configuration values — only the boolean flag is acted on.
 */
export async function fetchApiDemoMode(
  fetchImpl: typeof fetch,
  apiBaseUrl: string
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEMO_MODE_PROBE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(buildApiHealthUrl(apiBaseUrl), {
      method: "GET",
      signal: controller.signal
    });
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` Details: ${error.message}` : "";
    throw new Error(
      `Unable to reach Query402 API at ${apiBaseUrl} to read the demo mode flag. Check API_BASE_URL and confirm the API server is running.${detail}`,
      { cause: error }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(
      `Unable to read the demo mode flag from Query402 API at ${apiBaseUrl} (health endpoint returned status ${response.status}).`
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `Query402 API at ${apiBaseUrl} returned a non-JSON health response while reading the demo mode flag.`
    );
  }

  if (!isApiDemoModeSnapshot(body)) {
    throw new Error(
      `Query402 API at ${apiBaseUrl} did not report a boolean demoMode flag on its health endpoint.`
    );
  }

  return body.demoMode === true;
}

/**
 * Guard entry point for the agent demo.
 *
 * Reads the target API's demo-mode flag BEFORE any payment material is
 * constructed and throws a non-secret error when demo mode is off.
 */
export async function assertApiDemoMode(
  fetchImpl: typeof fetch,
  apiBaseUrl: string
): Promise<void> {
  const demoMode = await fetchApiDemoMode(fetchImpl, apiBaseUrl);

  if (!demoMode) {
    throw new DemoModeDisabledError(
      `Query402 API at ${apiBaseUrl} is not in demo mode (DEMO_MODE=false). ` +
        "The agent demo refuses to run against a paid API. " +
        "Start the API with DEMO_MODE=true, or use validate:real for sponsored real payments."
    );
  }
}

/** Returns the client's local demo-mode config flag (diagnostics only). */
export function isLocalClientDemoMode(): boolean {
  return config.DEMO_MODE === "true";
}
