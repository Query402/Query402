import { runPaidQuery } from "./client.js";

type QueryMode = "search" | "news" | "scrape";

function usage() {
  console.log("Usage:");
  console.log('  npm run cli -- search "latest soroban updates" --provider search.basic');
  console.log('  npm run cli -- news "stablecoin micropayments" --provider news.fast');
  console.log('  npm run cli -- scrape "https://example.com" --provider scrape.page');
}

function readArg(flag: string, args: string[]) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const modeArg = args[0];
  const term = args[1];

  if (!modeArg || !["search", "news", "scrape"].includes(modeArg)) {
    usage();
    process.exit(1);
  }

  const mode = modeArg as QueryMode;

  if (!term || term.startsWith("--")) {
    if (mode === "scrape") {
      console.error("Missing URL for scrape mode.\n");
    } else {
      console.error(`Missing query for ${mode} mode.\n`);
    }
    usage();
    process.exit(1);
  }

  const provider =
    readArg("--provider", args) ??
    (mode === "search" ? "search.basic" : mode === "news" ? "news.fast" : "scrape.page");

  const result = await runPaidQuery({
    mode,
    provider,
    query: mode === "scrape" ? undefined : term,
    url: mode === "scrape" ? term : undefined
  });

  console.log("\n=== Query402 Paid Request ===");
  console.log(`Endpoint: ${result.endpoint}`);
  console.log(`Provider: ${provider}`);
  console.log(`Status: ${result.status}`);
  console.log(`Payment Header: ${result.paymentResponse ?? "<none>"}`);

  const payload = result.body as Record<string, any>;
  const price = payload?.result?.priceUsd ?? payload?.body?.result?.priceUsd;
  const trace = payload?.result?.traceId ?? payload?.body?.result?.traceId;

  if (price) {
    console.log(`Price Paid (USD): ${price}`);
  }
  if (trace) {
    console.log(`Trace ID: ${trace}`);
  }

  console.log("Response summary:");
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error("CLI request failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
