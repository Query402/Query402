import { fileURLToPath } from "node:url";
import { runPaidQuery } from "./client.js";
import { assertApiDemoMode, DemoModeDisabledError } from "./demo-guard.js";

const DEMO_STEPS = [
  {
    mode: "search" as const,
    provider: "search.pro",
    query: "latest stellar x402 updates"
  },
  {
    mode: "news" as const,
    provider: "news.deep",
    query: "stablecoin micropayments"
  },
  {
    mode: "scrape" as const,
    provider: "scrape.extract",
    url: "https://developers.stellar.org"
  }
];

export async function runDemo(fetchImpl: typeof fetch = fetch): Promise<void> {
  // Read the demo-mode flag from the API BEFORE constructing any challenge,
  // signer, or payment. Fail closed: nothing is signed and nothing is paid
  // unless the target API confirms demo mode is on.
  await assertApiDemoMode(fetchImpl, process.env.API_BASE_URL ?? "http://localhost:3001");

  for (const step of DEMO_STEPS) {
    console.log(`\n--- Running ${step.mode} with ${step.provider} ---`);
    const response = await runPaidQuery(step);
    console.log(`Status: ${response.status}`);
    console.log(`Endpoint: ${response.endpoint}`);
    console.log(`Payment response: ${response.paymentResponse ?? "<none>"}`);
    const payload = response.body as any;
    console.log(`Price: $${payload?.result?.priceUsd ?? "n/a"}`);
    console.log(`Items: ${payload?.result?.items?.length ?? 0}`);
  }

  console.log(
    "\nDemo complete. Inspect /api/analytics in the backend for updated spend history."
  );
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  runDemo().catch((error) => {
    if (error instanceof DemoModeDisabledError) {
      console.error(`Demo aborted: ${error.message}`);
    } else {
      console.error("Demo failed:", error instanceof Error ? error.message : error);
    }
    process.exit(1);
  });
}
