import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MAX_ASSET_BYTES,
  SIZE_ALLOWLIST,
  checkStaticAssets,
  formatAssetReport
} from "./check-static-assets.mjs";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
const WOFF = Buffer.from("wOFF");
const WOFF2 = Buffer.from("wOF2");

async function withTempRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "static-assets-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeAsset(root, relativePath, contents) {
  const filePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

test("accepts PNG, JPEG, WebP, WOFF, and WOFF2 signatures in root and app public directories", async () => {
  await withTempRoot(async (root) => {
    const samples = [
      ["public/icon.png", PNG],
      ["public/photo.jpg", JPEG],
      ["public/photo.jpeg", JPEG],
      ["public/mark.webp", WEBP],
      ["public/font.woff", WOFF],
      ["public/font.woff2", WOFF2],
      ["apps/web/public/icon.png", PNG],
      ["apps/web/public/photo.jpg", JPEG],
      ["apps/web/public/mark.webp", WEBP],
      ["apps/web/public/font.woff", WOFF],
      ["apps/web/public/font.woff2", WOFF2]
    ];

    for (const [relativePath, contents] of samples) {
      await writeAsset(root, relativePath, contents);
    }

    const findings = await checkStaticAssets(root);
    assert.deepEqual(findings, []);
  });
});

test("reports a mismatched extension with detected type and byte size only", async () => {
  await withTempRoot(async (root) => {
    await writeAsset(root, "apps/web/public/photo.png", JPEG);

    const findings = await checkStaticAssets(root);
    assert.equal(findings.length, 1);
    assert.deepEqual(findings[0], {
      path: "apps/web/public/photo.png",
      type: "jpeg",
      bytes: JPEG.length
    });
    assert.equal(
      formatAssetReport(findings[0]),
      `path=apps/web/public/photo.png type=jpeg bytes=${JPEG.length}`
    );
  });
});

test("rejects an oversized file that is not on the allowlist", async () => {
  await withTempRoot(async (root) => {
    const contents = Buffer.alloc(MAX_ASSET_BYTES + 1);
    PNG.copy(contents);
    await writeAsset(root, "public/oversized.png", contents);
    await writeAsset(root, "apps/web/src/not-public.png", contents);

    const findings = await checkStaticAssets(root);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].path, "public/oversized.png");
    assert.equal(findings[0].type, "png");
    assert.equal(findings[0].bytes, MAX_ASSET_BYTES + 1);
    assert.equal(Object.keys(findings[0]).join(","), "path,type,bytes");
  });
});

test("allows only the temporary oversized logo paths", async () => {
  assert.deepEqual(SIZE_ALLOWLIST, [
    "apps/web/public/assets/query402-logo.png",
    "public/Query402-logo.png"
  ]);

  await withTempRoot(async (root) => {
    const contents = Buffer.alloc(MAX_ASSET_BYTES + 1);
    PNG.copy(contents);
    for (const relativePath of SIZE_ALLOWLIST) {
      await writeAsset(root, relativePath, contents);
    }

    const findings = await checkStaticAssets(root);
    assert.deepEqual(findings, []);
  });
});
