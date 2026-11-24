import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findSourceViolations, formatViolations } from "./check-lock-sources.mjs";

const FIXTURE_DIRECTORY = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "package-lock-policy"
);

async function readFixture(name) {
  return JSON.parse(await readFile(path.join(FIXTURE_DIRECTORY, name), "utf8"));
}

test("accepts npm registry tarballs and workspace links", async () => {
  const fixture = await readFixture("allowed.json");
  assert.deepEqual(findSourceViolations(fixture), []);
});

test("rejects unreviewed source schemes and hosts without revealing URLs", async () => {
  const fixture = await readFixture("rejected.json");
  const violations = findSourceViolations(fixture);
  const messages = formatViolations(violations);

  assert.equal(violations.length, 7);
  assert.deepEqual(
    messages.map((message) => message.split(": ")[0]),
    [
      "node_modules/git-package",
      "node_modules/git-protocol-package",
      "node_modules/file-package",
      "node_modules/link-package",
      "node_modules/untracked-link",
      "node_modules/http-package",
      "node_modules/external-package"
    ]
  );

  const diagnostics = messages.join("\n");
  for (const secret of [
    "credential",
    "signed-secret",
    "plain-http-secret",
    "signed-query-secret"
  ]) {
    assert.equal(diagnostics.includes(secret), false);
  }
  assert.equal(diagnostics.includes("example.com"), false);
});

test("allows exceptional HTTPS hosts only when explicitly allowlisted", async () => {
  const fixture = {
    packages: {
      "node_modules/exceptional-package": {
        resolved: "https://packages.example.com/exceptional-package.tgz"
      }
    }
  };

  assert.equal(findSourceViolations(fixture).length, 1);
  assert.deepEqual(
    findSourceViolations(fixture, { allowlistedHosts: new Set(["packages.example.com"]) }),
    []
  );
});
