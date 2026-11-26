import { mkdtemp, readdir, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();

export function findLeaks(content, includedLines) {
  const leaks = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    if (includedLines && !includedLines.has(i)) {
      continue;
    }
    const line = lines[i];
    const lineNum = i + 1;

    // 1. Stellar secret key: S... followed by 55 alphanumeric chars
    const secretKeyRegex = /\bS[A-Z0-9]{55}\b/g;
    let match;
    while ((match = secretKeyRegex.exec(line)) !== null) {
      leaks.push({ lineNum, pattern: "Stellar Secret Key" });
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
    const facilitatorKeyRegex =
      /(?:facilitator.*api.*key|x402.*facilitator.*api.*key)\s*[:=]\s*["']?([a-zA-Z0-9_\-]+)["']?/gi;
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

    // 5. X-Payment / x402-payment Header or payment-response header
    const paymentHeaderRegex =
      /(?:x-payment|x402-payment|payment-response|x-payment-response)\s*[:=]\s*["']?([a-zA-Z0-9_\-\[\]\+\/=]+)["']?/gi;
    while ((match = paymentHeaderRegex.exec(line)) !== null) {
      const val = match[1];
      const isRedacted =
        val.toLowerCase().includes("redacted") ||
        val.includes("XXXX") ||
        val.startsWith("[") ||
        val.endsWith("]") ||
        val.startsWith("demo_tx_") ||
        val.startsWith("demo-proof-") ||
        ["none", "<none>", "tx_test", "proof_123", "demo-proof-news", "demo-proof-scrape"].includes(
          val.toLowerCase()
        );
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

export function formatLeakLine(relativePath, leak) {
  return `  - ${relativePath}:${leak.lineNum}: [${leak.pattern}] (matched value redacted)`;
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
        continue;
      }
      files.push(...(await walk(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

export function resolveSafeTargetPath(rawTarget, baseDir = ROOT) {
  if (typeof rawTarget !== "string" || rawTarget.trim().length === 0) {
    throw new Error("Target path must be a non-empty string.");
  }
  if (rawTarget.includes("\0")) {
    throw new Error("Invalid target path containing null byte.");
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, rawTarget);
  const rel = path.relative(resolvedBase, resolvedTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Refusing to scan target outside workspace root: ${rawTarget}`);
  }
  return resolvedTarget;
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  const targets = [];
  let selfTestOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--self-test") {
      selfTestOnly = true;
      continue;
    }
    if (arg === "--target") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing path value after --target.");
      }
      targets.push(next);
      i += 1;
      continue;
    }
    if (arg.startsWith("--target=")) {
      const value = arg.slice("--target=".length);
      if (!value) {
        throw new Error("Missing path value in --target=.");
      }
      targets.push(value);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown CLI flag: ${arg}`);
    }
    targets.push(arg);
  }

  return { targets, selfTestOnly };
}

async function getTargetFiles(targets, baseDir = ROOT) {
  const files = [];

  for (const rawTarget of targets) {
    const resolvedTarget = resolveSafeTargetPath(rawTarget, baseDir);
    let targetStat;
    try {
      targetStat = await stat(resolvedTarget);
    } catch {
      throw new Error(`Scan target does not exist: ${rawTarget}`);
    }

    if (targetStat.isDirectory()) {
      files.push(...(await walk(resolvedTarget)));
    } else if (targetStat.isFile()) {
      files.push(resolvedTarget);
    }
  }

  return files;
}

async function getReviewerFacingFiles(baseDir = ROOT) {
  const files = [];

  try {
    const docsFiles = await walk(path.join(baseDir, "docs"));
    files.push(...docsFiles);
  } catch {
    // docs folder optional
  }

  const rootFiles = await readdir(baseDir, { withFileTypes: true });
  for (const entry of rootFiles) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(path.join(baseDir, entry.name));
    }
  }

  files.push(path.join(baseDir, ".env.example"));
  files.push(...(await walk(path.join(baseDir, ".github", "workflows"))));

  return files;
}

export async function scanFilesForLeaks(files, baseDir = ROOT) {
  const findings = [];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const relativePath = path.relative(baseDir, file).replaceAll("\\", "/");
    const includedLines = relativePath.startsWith(".github/workflows/")
      ? getWorkflowEnvLines(content)
      : undefined;
    const leaks = findLeaks(content, includedLines);
    if (leaks.length > 0) {
      findings.push({ relativePath, leaks });
    }
  }

  return findings;
}

function getWorkflowEnvLines(content) {
  const lines = content.split(/\r?\n/);
  const envLines = new Set();

  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)env\s*:\s*(.*)$/.exec(lines[i]);
    if (!match) {
      continue;
    }

    const indentation = match[1].length;
    envLines.add(i);

    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim() || line.trimStart().startsWith("#")) {
        continue;
      }
      if (line.match(/^\s*/)[0].length <= indentation) {
        break;
      }
      envLines.add(j);
    }
  }

  return envLines;
}

async function runSelfTest() {
  const passingCases = [
    "Here is a safe redacted key: [REDACTED_PAYMENT_HEADER]",
    "x-payment-response: [REDACTED]",
    "payment-response: demo_tx_abcdef123",
    "x-payment-response: demo-proof-news",
    "payment-response: <none>",
    "Authorization: Bearer [REDACTED_BEARER_TOKEN]",
    "sponsorship-facilitator-api-key: XXXXXXXX",
    "x-payment: redacted",
    "x402-payment: [REDACTED]",
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
    },
    {
      text: "x402-payment: live_x402_payment_secret_token_999",
      pattern: "X-Payment Header"
    }
  ];

  console.log("Running check-payment-leaks self-test...");

  for (const pass of passingCases) {
    const leaks = findLeaks(pass);
    if (leaks.length > 0) {
      console.error(`Self-test failed: Expected no leaks in "${pass}", but found:`, leaks.length);
      process.exit(1);
    }
  }

  for (const fail of failingCases) {
    const leaks = findLeaks(fail.text);
    if (leaks.length === 0) {
      console.error(
        `Self-test failed: Expected leak for pattern "${fail.pattern}", but none found.`
      );
      process.exit(1);
    }
    const matchedLeak = leaks.find((l) => l.pattern === fail.pattern);
    if (!matchedLeak) {
      console.error(`Self-test failed: Expected leak of type "${fail.pattern}".`);
      process.exit(1);
    }
    const formatted = formatLeakLine("transcript/sample.txt", matchedLeak);
    if (formatted.includes(matchedLeak.match)) {
      console.error("Self-test failed: Formatted failure line leaked raw secret value.");
      process.exit(1);
    }
  }

  // Temporary transcript directory fixture test
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "query402-leak-test-"));
  try {
    const transcriptDir = path.join(tempRoot, "transcript");
    await mkdir(transcriptDir, { recursive: true });

    const cleanFile = path.join(transcriptDir, "clean-transcript.md");
    await writeFile(
      cleanFile,
      "# Demo Transcript\nx-payment: [REDACTED]\nAuthorization: Bearer [REDACTED_BEARER_TOKEN]\n",
      "utf8"
    );

    const cleanFiles = await getTargetFiles(["transcript"], tempRoot);
    const cleanFindings = await scanFilesForLeaks(cleanFiles, tempRoot);
    if (cleanFindings.length !== 0) {
      console.error("Self-test failed: Expected 0 findings in clean temporary transcript fixture.");
      process.exit(1);
    }

    const leakedSecret = "SBU4V2PLOHV6J3Z3W2N3M3K3L3J3H3G3F3E3D3C3B3A3938373635343";
    const leakedFile = path.join(transcriptDir, "leaked-transcript.log");
    await writeFile(leakedFile, `line 1 ok\nsecret=${leakedSecret}\n`, "utf8");

    const allFiles = await getTargetFiles(["transcript"], tempRoot);
    const findings = await scanFilesForLeaks(allFiles, tempRoot);
    if (findings.length !== 1 || findings[0].relativePath !== "transcript/leaked-transcript.log") {
      console.error("Self-test failed: Expected leak finding in transcript/leaked-transcript.log.");
      process.exit(1);
    }
    const reportLine = formatLeakLine(findings[0].relativePath, findings[0].leaks[0]);
    if (
      !reportLine.includes("transcript/leaked-transcript.log:2") ||
      !reportLine.includes("[Stellar Secret Key]") ||
      reportLine.includes(leakedSecret)
    ) {
      console.error("Self-test failed: Failure report line did not redact matched value properly.");
      process.exit(1);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  console.log("Self-test passed successfully!");
}

export async function runPaymentLeakCheck(options = {}) {
  // Always run self-test to verify parsing and fixture logic
  await runSelfTest();

  const cli = options.argv
    ? parseCliArgs(options.argv)
    : { targets: options.targets ?? [], selfTestOnly: false };
  if (cli.selfTestOnly) {
    return;
  }

  const baseDir = options.baseDir ?? ROOT;
  const targets = options.targets ?? cli.targets;
  const files =
    targets && targets.length > 0
      ? await getTargetFiles(targets, baseDir)
      : await getReviewerFacingFiles(baseDir);

  const findings = await scanFilesForLeaks(files, baseDir);

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`Leak detected in file: ${finding.relativePath}`);
      for (const leak of finding.leaks) {
        console.error(formatLeakLine(finding.relativePath, leak));
      }
    }
    throw new Error("Payment leaks validation failed.");
  }

  console.log("No payment leaks found in scanned artifacts.");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const cli = parseCliArgs(process.argv.slice(2));
  runPaymentLeakCheck({ targets: cli.targets, argv: process.argv.slice(2) }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
