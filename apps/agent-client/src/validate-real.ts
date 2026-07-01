import { config } from "./config.js";
import { runPaidQuery } from "./client.js";
import { fileURLToPath } from "node:url";

export function safeFacilitatorUrl(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function formatTimestamp(): string {
  return new Date().toISOString();
}

function hasPlaceholder(value?: string) {
  if (!value) {
    return true;
  }
  return value.includes("XXXXXXXX") || value.includes("GXXXX") || value.includes("SXXXX");
}

async function checkFacilitator(url: string) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const facilitatorHeaders =
      config.X402_FACILITATOR_API_KEY && config.X402_FACILITATOR_API_KEY.length > 0
        ? { Authorization: `Bearer ${config.X402_FACILITATOR_API_KEY}` }
        : undefined;

    const response = await fetch(`${url.replace(/\/$/, "")}/supported`, {
      signal: controller.signal,
      headers: facilitatorHeaders
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { ok: false, status: response.status, body: await response.text() };
    }

    const json = await response.json();
    return { ok: true, status: response.status, body: json };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: error instanceof Error ? `${error.message}. Check DNS/network or URL.` : String(error)
    };
  }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkApiHealth() {
  try {
    const response = await fetchWithTimeout(`${config.API_BASE_URL}/health`, {}, 20000);
    if (!response.ok) {
      throw new Error(`API health check failed: ${response.status}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`API is not reachable at ${config.API_BASE_URL}. Details: ${message}`);
  }
}

async function main() {
  console.log("\n=== Query402 Real Payment Validation ===");
  console.log(`API: ${config.API_BASE_URL}`);
  console.log(`Network: ${config.STELLAR_NETWORK}`);

  const network = config.STELLAR_NETWORK;
  const probeTimestamp = formatTimestamp();
  const facilitatorHost = safeFacilitatorUrl(config.X402_FACILITATOR_URL);

  console.log("\n--- Facilitator Health ---");
  if (!config.X402_FACILITATOR_URL) {
    console.log(`Host: not configured`);
    console.log(`Warning: X402_FACILITATOR_URL is not set. Set it in your .env file for real payment validation.`);
    console.log(`Probe attempted: no`);
    console.log(`Network: ${network}`);
    console.log(`Timestamp: ${probeTimestamp}`);
    throw new Error("X402_FACILITATOR_URL is not configured. Real payment validation requires a facilitator URL.");
  } else {
    console.log(`Host: ${facilitatorHost ?? "unparseable"}`);
    console.log(`Network: ${network}`);
    console.log("[probe] Checking facilitator /supported...");
    const healthResult = await checkFacilitator(config.X402_FACILITATOR_URL);
    const reasonText = healthResult.ok ? undefined : typeof healthResult.body === "string" ? healthResult.body : JSON.stringify(healthResult.body);
    console.log(`Probe attempted: yes`);
    console.log(`Status: ${healthResult.status === 0 ? "N/A" : healthResult.status}`);
    if (!healthResult.ok && reasonText) {
      console.log(`Reason: ${reasonText}`);
    }
    console.log(`Timestamp: ${probeTimestamp}`);

    if (!healthResult.ok) {
      throw new Error(
        `Facilitator check failed (${healthResult.status}): ${reasonText}`
      );
    }
    console.log("[ok] Facilitator reachable and returned /supported response.");
  }

  if (config.DEMO_MODE === "true") {
    throw new Error("DEMO_MODE=true. Real payment validation requires DEMO_MODE=false.");
  }

  if (hasPlaceholder(config.DEMO_CLIENT_SECRET_KEY)) {
    throw new Error(
      "DEMO_CLIENT_SECRET_KEY is missing or placeholder. Use a funded real secret key."
    );
  }

  if (hasPlaceholder(config.DEMO_CLIENT_PUBLIC_KEY)) {
    console.warn(
      "[warn] DEMO_CLIENT_PUBLIC_KEY seems placeholder; continuing (optional for client flow).\n"
    );
  }

  if (hasPlaceholder(config.X402_PAY_TO_ADDRESS)) {
    throw new Error(
      "X402_PAY_TO_ADDRESS is missing or placeholder. Set a funded seller/public receiving address."
    );
  }

  if (
    config.X402_FACILITATOR_URL?.includes("channels.openzeppelin.com") &&
    !config.X402_FACILITATOR_API_KEY
  ) {
    throw new Error(
      "X402_FACILITATOR_API_KEY is required for OpenZeppelin facilitator. Generate one from https://channels.openzeppelin.com/testnet/gen"
    );
  }

  console.log("[step] Checking API health...");
  await checkApiHealth();
  console.log("[ok] API health check passed.");

  console.log("[step] Executing real paid request...");
  const result = await runPaidQuery({
    mode: "search",
    provider: "search.basic",
    query: "latest stellar x402 updates"
  });

  if (!result.ok) {
    throw new Error(
      `Paid request failed with status ${result.status}. Response: ${JSON.stringify(result.body)}`
    );
  }

  const paymentHeader =
    result.paymentResponse ?? (result.body as any)?.payment?.paymentResponseHeader ?? null;

  console.log("\n--- Real payment proof ---");
  console.log(`Status: ${result.status}`);
  console.log(`Endpoint: ${result.endpoint}`);
  console.log(`Payment header: ${paymentHeader ?? "<none>"}`);
  console.log(`Trace ID: ${(result.body as any)?.result?.traceId ?? "n/a"}`);
  console.log(`Provider: ${(result.body as any)?.result?.providerId ?? "n/a"}`);
  console.log(`Price: ${(result.body as any)?.result?.priceUsd ?? "n/a"}`);

  if (!paymentHeader) {
    throw new Error("No payment proof header found. Check facilitator/wallet settlement path.");
  }

  console.log("\n✅ Real payment validation completed.");
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((error) => {
    console.error("\n❌ Validation failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
