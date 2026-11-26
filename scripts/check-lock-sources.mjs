import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NPM_REGISTRY_HOST = "registry.npmjs.org";
const ALLOWLISTED_HOSTS = new Set();

function addViolation(violations, packagePath, source, reason) {
  violations.push({ packagePath, source, reason });
}

function matchesWorkspacePattern(packagePath, workspacePatterns) {
  const packageSegments = packagePath.split("/");

  return workspacePatterns.some((pattern) => {
    const patternSegments = pattern.replaceAll("\\", "/").split("/");
    return (
      patternSegments.length === packageSegments.length &&
      patternSegments.every((segment, index) =>
        segment === "*" ? packageSegments[index].length > 0 : segment === packageSegments[index]
      )
    );
  });
}

function collectPackageEntries(lockfile) {
  if (lockfile.packages && typeof lockfile.packages === "object") {
    return Object.entries(lockfile.packages);
  }

  const entries = [];
  function collectDependencies(dependencies, parentPath = "") {
    for (const [name, packageInfo] of Object.entries(dependencies ?? {})) {
      const packagePath = parentPath
        ? `${parentPath}/node_modules/${name}`
        : `node_modules/${name}`;
      entries.push([packagePath, packageInfo]);
      collectDependencies(packageInfo?.dependencies, packagePath);
    }
  }

  collectDependencies(lockfile.dependencies);
  return entries;
}

function inspectResolvedSource(
  packagePath,
  packageInfo,
  workspacePaths,
  allowlistedHosts,
  violations
) {
  const resolved = packageInfo.resolved;
  if (!Object.hasOwn(packageInfo, "resolved")) {
    return;
  }

  if (typeof resolved !== "string") {
    addViolation(violations, packagePath, "resolved", "unsupported-source");
    return;
  }

  if (/^(?:git(?:\+[^:]+)?|file|link|http):/i.test(resolved)) {
    addViolation(violations, packagePath, "resolved", "disallowed-source-scheme");
    return;
  }

  let sourceUrl;
  try {
    sourceUrl = new URL(resolved);
  } catch {
    addViolation(violations, packagePath, "resolved", "unsupported-source");
    return;
  }

  if (sourceUrl.protocol !== "https:") {
    addViolation(violations, packagePath, "resolved", "unsupported-source");
    return;
  }

  if (sourceUrl.username || sourceUrl.password) {
    addViolation(violations, packagePath, "resolved", "embedded-credentials");
    return;
  }

  const isNpmRegistry =
    sourceUrl.hostname === NPM_REGISTRY_HOST && (sourceUrl.port === "" || sourceUrl.port === "443");
  if (!isNpmRegistry && !allowlistedHosts.has(sourceUrl.hostname)) {
    addViolation(violations, packagePath, "resolved", "unreviewed-host");
  }
}

export function findSourceViolations(lockfile, { allowlistedHosts = ALLOWLISTED_HOSTS } = {}) {
  if (!lockfile || typeof lockfile !== "object") {
    throw new Error("Lockfile must be a JSON object");
  }

  const packageEntries = collectPackageEntries(lockfile);
  const declaredWorkspacePatterns = lockfile.packages?.[""]?.workspaces;
  const workspacePatterns = Array.isArray(declaredWorkspacePatterns)
    ? declaredWorkspacePatterns
    : [];
  const workspacePaths = new Set(
    packageEntries
      .filter(([packagePath, packageInfo]) =>
        packagePath && !packagePath.startsWith("node_modules/") && packageInfo?.name
          ? matchesWorkspacePattern(packagePath, workspacePatterns)
          : false
      )
      .map(([packagePath]) => packagePath)
  );
  const violations = [];

  for (const [packagePath, packageInfo] of packageEntries) {
    if (!packageInfo || typeof packageInfo !== "object") {
      continue;
    }

    if (packageInfo.link === true) {
      if (typeof packageInfo.resolved === "string" && workspacePaths.has(packageInfo.resolved)) {
        continue;
      }
      addViolation(violations, packagePath || ".", "link", "unrecognized-link-target");
      continue;
    }

    inspectResolvedSource(
      packagePath || ".",
      packageInfo,
      workspacePaths,
      allowlistedHosts,
      violations
    );
  }

  return violations;
}

export function formatViolations(violations) {
  return violations.map(({ packagePath, source, reason }) => {
    const safePackagePath = packagePath
      .replace(/:\/\/[^/\s@]+@/g, "://[REDACTED]@")
      .replace(/\?[^\s#]*/g, "?[REDACTED]");
    return `${safePackagePath}: ${source} (${reason})`;
  });
}

async function main() {
  const lockfilePath = path.resolve(process.cwd(), "package-lock.json");
  let lockfileContent;
  try {
    lockfileContent = await readFile(lockfilePath, "utf8");
  } catch {
    throw new Error("Unable to read package-lock.json");
  }

  let lockfile;
  try {
    lockfile = JSON.parse(lockfileContent);
  } catch {
    throw new Error("Invalid JSON in package-lock.json");
  }

  const violations = findSourceViolations(lockfile);
  if (violations.length > 0) {
    for (const message of formatViolations(violations)) {
      console.error(message);
    }
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
