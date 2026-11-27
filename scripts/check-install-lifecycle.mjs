import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIFECYCLE_SCRIPTS = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly"
];
const ALLOWLIST = new Set();

async function readManifest(manifestPath, root) {
  const relativePath = path.relative(root, manifestPath).replaceAll("\\", "/");
  let content;

  try {
    content = await readFile(manifestPath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${relativePath}`, { cause: error });
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in ${relativePath}`);
  }
}

async function resolveWorkspaceDirectories(root, pattern) {
  const segments = pattern.split(/[\\/]/);
  let directories = [root];

  for (const segment of segments) {
    const nextDirectories = [];

    for (const directory of directories) {
      if (segment === "*") {
        const entries = await readdir(directory, { withFileTypes: true });
        nextDirectories.push(
          ...entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(directory, entry.name))
        );
      } else {
        nextDirectories.push(path.join(directory, segment));
      }
    }

    directories = nextDirectories;
  }

  return directories;
}

export async function findLifecycleViolations(root = process.cwd()) {
  const rootManifestPath = path.join(root, "package.json");
  const rootManifest = await readManifest(rootManifestPath, root);
  const workspaces = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces
    : rootManifest.workspaces?.packages;
  const manifestPaths = new Set([rootManifestPath]);

  for (const workspacePattern of workspaces ?? []) {
    const workspaceDirectories = await resolveWorkspaceDirectories(root, workspacePattern);
    for (const directory of workspaceDirectories) {
      manifestPaths.add(path.join(directory, "package.json"));
    }
  }

  const violations = [];
  for (const manifestPath of manifestPaths) {
    const manifest =
      manifestPath === rootManifestPath ? rootManifest : await readManifest(manifestPath, root);
    const relativePath = path.relative(root, manifestPath).replaceAll("\\", "/");

    for (const scriptName of LIFECYCLE_SCRIPTS) {
      const allowlistKey = `${relativePath}:${scriptName}`;
      if (Object.hasOwn(manifest.scripts ?? {}, scriptName) && !ALLOWLIST.has(allowlistKey)) {
        violations.push({ path: relativePath, scriptName });
      }
    }
  }

  return violations;
}

async function main() {
  const violations = await findLifecycleViolations();
  if (violations.length > 0) {
    for (const { path: manifestPath, scriptName } of violations) {
      console.error(`${manifestPath}: ${scriptName}`);
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
