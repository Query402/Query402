import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = /@[0-9a-f]{40}\b/;

describe("Actions allowlist", () => {
  it("pins every workflow action to a full SHA from the allowlist", () => {
    const allowlist = readFileSync(join(root, ".github/policies/actions-allowlist.txt"), "utf8");
    assert.match(allowlist, /^github_owned_allowed$/m);
    assert.match(allowlist, /^verified_allowed$/m);
    assert.match(allowlist, /^sha_pinning_required$/m);
    const workflows = readdirSync(join(root, ".github/workflows")).filter((name) =>
      name.endsWith(".yml")
    );
    for (const name of workflows) {
      const workflow = readFileSync(join(root, ".github/workflows", name), "utf8");
      const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1]);
      assert.ok(uses.length > 0, `${name} has no actions`);
      for (const action of uses) {
        assert.match(action, sha, action);
        assert.match(allowlist, new RegExp(`^${action}$`, "m"));
      }
    }
  });
});
