import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const workflow = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../.github/workflows/ci.yml"),
  "utf8"
);

describe("demo transcript artifact retention", () => {
  it("keeps the run-scoped artifact for 14 days and fails when no files are produced", () => {
    const upload = workflow.slice(workflow.indexOf("name: Upload transcript artifact"));
    assert.match(upload, /name: demo-transcript-\$\{\{ github\.run_id \}\}/);
    assert.match(upload, /retention-days:\s*14\b/);
    assert.match(upload, /if-no-files-found:\s*error/);
    assert.doesNotMatch(upload, /retention-days:\s*90\b/);
  });
});
