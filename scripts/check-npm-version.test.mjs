import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertCompatibleEnginesNpm,
  parseNpmVersion,
  parsePackageManagerField,
  verifyNpmToolchain
} from "./check-npm-version.mjs";

test("repository package.json pins npm@11.11.0 and matches active npm major 11", () => {
  const result = verifyNpmToolchain({ activeNpmVersion: "11.11.0" });
  assert.equal(result.packageManager, "npm@11.11.0");
  assert.equal(result.enginesNpm, ">=11.0.0 <12.0.0");
  assert.equal(result.expectedMajor, 11);
  assert.equal(result.activeMajor, 11);
});

test("verifyNpmToolchain accepts other patch/minor releases within the same npm major", () => {
  const result = verifyNpmToolchain({ activeNpmVersion: "11.13.0" });
  assert.equal(result.activeMajor, 11);
  assert.equal(result.expectedMajor, 11);
});

test("verifyNpmToolchain rejects mismatched active npm major", () => {
  assert.throws(
    () => verifyNpmToolchain({ activeNpmVersion: "10.9.2" }),
    /Active npm major 10 \(10\.9\.2\) does not match expected npm major 11/
  );
});

test("parsePackageManagerField requires exact npm@X.Y.Z", () => {
  assert.deepEqual(parsePackageManagerField("npm@11.11.0"), {
    raw: "11.11.0",
    major: 11,
    minor: 11,
    patch: 0
  });
  assert.throws(() => parsePackageManagerField(""), /must declare a "packageManager" field/);
  assert.throws(() => parsePackageManagerField("npm@^11.11.0"), /Expected exact "npm@X\.Y\.Z"/);
  assert.throws(() => parsePackageManagerField("pnpm@9.0.0"), /Expected exact "npm@X\.Y\.Z"/);
});

test("assertCompatibleEnginesNpm validates engines.npm range against expected major", () => {
  assert.doesNotThrow(() => assertCompatibleEnginesNpm(">=11.0.0 <12.0.0", 11));
  assert.throws(() => assertCompatibleEnginesNpm(undefined, 11), /must declare an "engines\.npm"/);
  assert.throws(
    () => assertCompatibleEnginesNpm(">=10.0.0 <11.0.0", 11),
    /Incompatible engines\.npm/
  );
});

test("parseNpmVersion rejects malformed versions", () => {
  assert.throws(() => parseNpmVersion("invalid"), /Invalid npm version/);
});

test("verifyNpmToolchain reads custom root manifest and rejects missing metadata", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "query402-npm-version-"));
  try {
    writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "fixture", engines: { node: ">=20.0.0 <25.0.0" } }),
      "utf8"
    );
    assert.throws(
      () => verifyNpmToolchain({ rootDir: tempDir, activeNpmVersion: "11.11.0" }),
      /must declare a "packageManager" field/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
