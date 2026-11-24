import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Per-file budget for web assets. 1 MB = 1,048,576 bytes. */
export const MAX_ASSET_BYTES = 1_048_576;

const HEADER_BYTES = 16;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Temporary size exceptions while these logos are still oversized.
 * Any other file over the 1 MB budget must fail. Remove a path once that
 * file is shrunk.
 */
export const SIZE_ALLOWLIST = [
  "apps/web/public/assets/query402-logo.png",
  "public/Query402-logo.png"
];

const ALLOWED_SIZES = new Set(SIZE_ALLOWLIST);

const EXTENSION_TYPES = new Map([
  [".png", "png"],
  [".jpg", "jpeg"],
  [".jpeg", "jpeg"],
  [".webp", "webp"],
  [".woff", "woff"],
  [".woff2", "woff2"]
]);

/**
 * Identify a file from its leading bytes. This never executes the file.
 * @param {Buffer} header
 * @returns {"png" | "jpeg" | "webp" | "woff" | "woff2" | "unknown"}
 */
export function detectAssetType(header) {
  if (
    header.length >= PNG_SIGNATURE.length &&
    header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return "png";
  }
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "jpeg";
  }
  if (
    header.length >= 12 &&
    header.subarray(0, 4).toString("ascii") === "RIFF" &&
    header.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  if (header.length >= 4 && header.subarray(0, 4).toString("ascii") === "wOFF") {
    return "woff";
  }
  if (header.length >= 4 && header.subarray(0, 4).toString("ascii") === "wOF2") {
    return "woff2";
  }
  return "unknown";
}

/**
 * @param {{ path: string, type: string, bytes: number }} finding
 */
export function formatAssetReport(finding) {
  return `path=${finding.path} type=${finding.type} bytes=${finding.bytes}`;
}

/**
 * @param {string} rootDir
 * @returns {Promise<Array<{ path: string, type: string, bytes: number }>>}
 */
export async function checkStaticAssets(rootDir) {
  const findings = [];
  const directories = await publicDirectories(rootDir);

  for (const directory of directories) {
    const files = await walkFiles(directory);
    for (const filePath of files) {
      const relativePath = toPosix(path.relative(rootDir, filePath));
      const info = await stat(filePath);
      const header = await readHeader(filePath);
      const detected = detectAssetType(header);
      const expected = EXTENSION_TYPES.get(path.extname(filePath).toLowerCase());
      const signatureMismatch = expected !== undefined && detected !== expected;
      const overBudget = info.size > MAX_ASSET_BYTES && !ALLOWED_SIZES.has(relativePath);

      if (signatureMismatch || overBudget) {
        findings.push({
          path: relativePath,
          type: detected,
          bytes: info.size
        });
      }
    }
  }

  findings.sort((left, right) => left.path.localeCompare(right.path));
  return findings;
}

async function publicDirectories(rootDir) {
  const directories = [];
  const rootPublic = path.join(rootDir, "public");
  if (await isDirectory(rootPublic)) {
    directories.push(rootPublic);
  }

  const appsDir = path.join(rootDir, "apps");
  let apps = [];
  try {
    apps = await readdir(appsDir, { withFileTypes: true });
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }

  for (const entry of apps) {
    if (!entry.isDirectory()) {
      continue;
    }
    const appPublic = path.join(appsDir, entry.name, "public");
    if (await isDirectory(appPublic)) {
      directories.push(appPublic);
    }
  }

  return directories;
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function readHeader(filePath) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function isDirectory(directory) {
  try {
    const info = await stat(directory);
    return info.isDirectory();
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
}

function isMissing(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

async function main() {
  const rootDir = process.cwd();
  const findings = await checkStaticAssets(rootDir);
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(formatAssetReport(finding));
    }
    process.exit(1);
  }
  console.log("Static asset guard passed.");
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  await main();
}
