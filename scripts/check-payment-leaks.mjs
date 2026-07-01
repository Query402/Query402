import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

function findLeaks(content) {
  const leaks = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // 1. Stellar secret key: S... followed by 55 alphanumeric chars
    const secretKeyRegex = /\b(S[A-Z0-9]{55})\b/g;
    let match;
    while ((match = secretKeyRegex.exec(line)) !== null) {
      const key = match[1];
      if (!key.includes("XXXX")) {
        leaks.push({ lineNum, pattern: "Stellar Secret Key", match: key });
      }
    }

    // 2. Private key block
    const privateKeyBlockRegex = /(-----BEGIN[ A-Z]*PRIVATE KEY-----)/g;
    while ((match = privateKeyBlockRegex.exec(line)) !== null) {
      leaks.push({ lineNum, pattern: "Private Key Block", match: match[1] });
    }

    // 3. Bearer Token
    const bearerRegex = /\bbearer\s+([^\s"';,]+)/gi;
    while ((match = bearerRegex.exec(line)) !== null) {
      const token = match[1];
      const isRedacted =
        token.toLowerCase().includes("redacted") ||
        token.includes("XXXX") ||
        token.startsWith("[") ||
        token.endsWith("]") ||
        token.toLowerCase() === "token_abc" ||
        token.toLowerCase() === "${config" ||
        token.toLowerCase() === "${process";
      if (!isRedacted) {
        leaks.push({ lineNum, pattern: "Bearer Token", match: token });
      }
    }

    // 4. Facilitator API Key
    const facilitatorKeyRegex = /(?:facilitator.*api.*key|x402.*facilitator.*api.*key)\s*[:=]\s*["']?([a-zA-Z0-9_\-]+)["']?/gi;
    while ((match = facilitatorKeyRegex.exec(line)) !== null) {
      const val = match[1];
      const isRedacted =
        val.toLowerCase().includes("redacted") ||
        val.includes("XXXX") ||
        val.startsWith("[") ||
        val.endsWith("]") ||
        val.toLowerCase() === "${config" ||
        val.toLowerCase() === "supported";
      if (!isRedacted) {
        leaks.push({ lineNum, pattern: "Facilitator API Key", match: val });
      }
    }

    // 5. X-Payment Header or payment-response header
    const paymentHeaderRegex = /(?:x-payment|payment-response|x-payment-response)\s*[:=]\s*["']?([a-zA-Z0-9_\-\[\]\+\/=]+)["']?/gi;
    while ((match = paymentHeaderRegex.exec(line)) !== null) {
      const val = match[1];
      const isRedacted =
        val.toLowerCase().includes("redacted") ||
        val.includes("XXXX") ||
        val.startsWith("[") ||
        val.endsWith("]") ||
        val.startsWith("demo_tx_") ||
        val.startsWith("demo-proof-") ||
        ["none", "<none>", "tx_test", "proof_123", "demo-proof-news", "demo-proof-scrape"].includes(val.toLowerCase());
      if (!isRedacted) {
        leaks.push({ lineNum, pattern: "X-Payment Header", match: val });
      }
    }

    // 6. Raw XDR payment envelope blob
    const xdrRegex = /\b(AAAA[A-Za-z0-9+/]{40,}={0,2})\b/g;
    while ((match = xdrRegex.exec(line)) !== null) {
      leaks.push({ lineNum, pattern: "Raw XDR Envelope Blob", match: match[1] });
    }

    // 7. Raw Transaction Hash
    const txHashRegex = /\b([0-9a-fA-F]{64})\b/g;
    while ((match = txHashRegex.exec(line)) !== null) {
      leaks.push({ lineNum, pattern: "Stellar Transaction Hash", match: match[1] });
    }
  }

  return leaks;
}

function runSelfTest() {
  const passingCases = [
    "Here is a safe redacted key: [REDACTED_PAYMENT_HEADER]",
    "x-payment-response: [REDACTED]",
    "payment-response: demo_tx_abcdef123",
    "x-payment-response: demo-proof-news",
    "payment-response: <none>",
    "Authorization: Bearer [REDACTED_BEARER_TOKEN]",
    "sponsorship-facilitator-api-key: XXXXXXXX",
    "x-payment: redacted",
    "We have some normal text here with no leaks."
  ];

  const failingCases = [
    {
      text: "Here is a Stellar secret key: SBU4V2PLOHV6J3Z3W2N3M3K3L3J3H3G3F3E3D3C3B3A3938373635343",
      pattern: "Stellar Secret Key"
    },
    {
      text: "Here is a private key block: -----BEGIN PRIVATE KEY-----",
      pattern: "Private Key Block"
    },
    {
      text: "Bearer token leaked: Bearer sub_token_123456789",
      pattern: "Bearer Token"
    },
    {
      text: "facilitator-api-key: secret_api_key_123",
      pattern: "Facilitator API Key"
    },
    {
      text: "payment-response: AAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      pattern: "Raw XDR Envelope Blob"
    },
    {
      text: "Stellar Tx Hash: 8b06de5e783424d9c79fa6791bfb2611a91e5d79435b6823c91d8487295bc58e",
      pattern: "Stellar Transaction Hash"
    },
    {
      text: "x-payment-response: actual_live_header_blob_123",
      pattern: "X-Payment Header"
    }
  ];

  console.log("Running check-payment-leaks self-test...");

  for (const pass of passingCases) {
    const leaks = findLeaks(pass);
    if (leaks.length > 0) {
      console.error(`Self-test failed: Expected no leaks in "${pass}", but found:`, leaks);
      process.exit(1);
    }
  }

  for (const fail of failingCases) {
    const leaks = findLeaks(fail.text);
    if (leaks.length === 0) {
      console.error(`Self-test failed: Expected leak for pattern "${fail.pattern}" in "${fail.text}", but none found.`);
      process.exit(1);
    }
    const hasPattern = leaks.some((l) => l.pattern === fail.pattern);
    if (!hasPattern) {
      console.error(`Self-test failed: Expected leak of type "${fail.pattern}" in "${fail.text}", but found different type:`, leaks);
      process.exit(1);
    }
  }

  console.log("Self-test passed successfully!");
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
        continue;
      }
      files.push(...(await walk(fullPath)));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

async function getReviewerFacingFiles() {
  const files = [];

  try {
    const docsFiles = await walk(path.join(ROOT, "docs"));
    files.push(...docsFiles);
  } catch (error) {
    // docs folder optional
  }

  const rootFiles = await readdir(ROOT, { withFileTypes: true });
  for (const entry of rootFiles) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(path.join(ROOT, entry.name));
    }
  }

  return files;
}

export async function runPaymentLeakCheck() {
  // Always run self-test to verify parsing logic
  runSelfTest();

  if (process.argv.includes("--self-test")) {
    return;
  }

  const files = await getReviewerFacingFiles();
  let hasFailures = false;

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const leaks = findLeaks(content);

    if (leaks.length > 0) {
      const relativePath = path.relative(ROOT, file);
      console.error(`Leak detected in reviewer-facing file: ${relativePath}`);
      for (const leak of leaks) {
        console.error(`  - Line ${leak.lineNum}: [${leak.pattern}] matched value: "${leak.match}"`);
      }
      hasFailures = true;
    }
  }

  if (hasFailures) {
    throw new Error("Payment leaks validation failed.");
  }

  console.log("No payment leaks found in reviewer-facing artifacts.");
}

import { fileURLToPath } from "node:url";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runPaymentLeakCheck().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
