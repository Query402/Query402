import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CHECKER_PATH = fileURLToPath(new URL("./check-install-lifecycle.mjs", import.meta.url));
const LIFECYCLE_SCRIPTS = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly"
];

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "query402-lifecycle-check-"));
  await mkdir(path.join(root, "apps", "sample"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, workspaces: ["apps/*"] })
  );
  return root;
}

test("rejects every blocked lifecycle script without exposing command bodies", async () => {
  const root = await createFixture();

  try {
    const scripts = Object.fromEntries(
      LIFECYCLE_SCRIPTS.map((scriptName) => [scriptName, "DO_NOT_PRINT_OR_EXECUTE"])
    );
    await writeFile(path.join(root, "apps", "sample", "package.json"), JSON.stringify({ scripts }));

    const result = spawnSync(process.execPath, [CHECKER_PATH], {
      cwd: root,
      encoding: "utf8"
    });
    const lines = result.stderr.trim().split(/\r?\n/);

    assert.equal(result.status, 1);
    assert.deepEqual(
      lines,
      LIFECYCLE_SCRIPTS.map((scriptName) => `apps/sample/package.json: ${scriptName}`)
    );
    assert.equal(`${result.stdout}${result.stderr}`.includes("DO_NOT_PRINT_OR_EXECUTE"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("accepts workspace manifests without blocked lifecycle scripts", async () => {
  const root = await createFixture();

  try {
    await writeFile(
      path.join(root, "apps", "sample", "package.json"),
      JSON.stringify({ scripts: { test: "echo harmless" } })
    );

    const result = spawnSync(process.execPath, [CHECKER_PATH], {
      cwd: root,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
