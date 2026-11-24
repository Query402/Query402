import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_URL = "https://github.com/Query402/Query402";

async function readManifest(manifestPath) {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

async function getPackageManifests() {
  const rootManifestPath = path.join(ROOT, "package.json");
  const rootManifest = await readManifest(rootManifestPath);
  const manifests = [{ path: rootManifestPath, manifest: rootManifest }];

  for (const workspacePattern of rootManifest.workspaces) {
    const workspaceRoot = workspacePattern.replace(/\/\*$/, "");
    const entries = await readdir(path.join(ROOT, workspaceRoot), { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const manifestPath = path.join(ROOT, workspaceRoot, entry.name, "package.json");
      manifests.push({ path: manifestPath, manifest: await readManifest(manifestPath) });
    }
  }

  return manifests;
}

test("every root and workspace package has provenance and remains private", async () => {
  const manifests = await getPackageManifests();

  assert.equal(manifests.length, 5, "expected the root and four workspace manifests");

  for (const { path: manifestPath, manifest } of manifests) {
    assert.equal(manifest.private, true, `${manifestPath} must remain private`);
    assert.deepEqual(
      manifest.repository,
      {
        type: "git",
        url: REPOSITORY_URL
      },
      `${manifestPath} must declare the canonical repository`
    );
    assert.equal(manifest.license, "MIT", `${manifestPath} must declare the repository license`);
  }
});
