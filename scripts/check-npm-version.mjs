import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");

export function parseNpmVersion(versionString) {
  const normalized = String(versionString ?? "").trim();
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(normalized);
  if (!match) {
    throw new Error(`Invalid npm version "${versionString}". Expected exact semver (X.Y.Z).`);
  }
  return {
    raw: `${match[1]}.${match[2]}.${match[3]}`,
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10)
  };
}

export function parsePackageManagerField(packageManager) {
  if (typeof packageManager !== "string" || packageManager.trim().length === 0) {
    throw new Error('Root package.json must declare a "packageManager" field.');
  }
  const match = /^npm@(\d+\.\d+\.\d+)$/.exec(packageManager.trim());
  if (!match) {
    throw new Error(`Invalid packageManager "${packageManager}". Expected exact "npm@X.Y.Z".`);
  }
  return parseNpmVersion(match[1]);
}

export function assertCompatibleEnginesNpm(enginesNpm, expectedMajor) {
  if (typeof enginesNpm !== "string" || enginesNpm.trim().length === 0) {
    throw new Error('Root package.json must declare an "engines.npm" range.');
  }
  const trimmed = enginesNpm.trim();
  const expectedRange = `>=${expectedMajor}.0.0 <${expectedMajor + 1}.0.0`;
  const caretRange = `^${expectedMajor}.`;

  if (trimmed !== expectedRange && !trimmed.startsWith(caretRange)) {
    throw new Error(`Incompatible engines.npm "${enginesNpm}". Expected "${expectedRange}".`);
  }
}

export function detectActiveNpmVersion() {
  const output = execSync("npm --version", {
    encoding: "utf8"
  });
  return output.trim();
}

export function verifyNpmToolchain({
  rootDir = DEFAULT_ROOT,
  activeNpmVersion = detectActiveNpmVersion()
} = {}) {
  const pkgPath = path.join(rootDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

  const expected = parsePackageManagerField(pkg.packageManager);
  assertCompatibleEnginesNpm(pkg.engines?.npm, expected.major);

  const active = parseNpmVersion(activeNpmVersion);
  if (active.major !== expected.major) {
    throw new Error(
      `Active npm major ${active.major} (${active.raw}) does not match expected npm major ${expected.major} (${pkg.packageManager}).`
    );
  }

  return {
    packageManager: pkg.packageManager,
    enginesNpm: pkg.engines.npm,
    expectedMajor: expected.major,
    activeVersion: active.raw,
    activeMajor: active.major
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    const cliVersionArg = process.argv[2];
    const result = verifyNpmToolchain(
      cliVersionArg ? { activeNpmVersion: cliVersionArg } : undefined
    );
    console.log(
      `Verified npm ${result.activeVersion} (major ${result.activeMajor}) matches ${result.packageManager}.`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
