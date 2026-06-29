import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { runPaymentLeakCheck } from "./check-payment-leaks.mjs";

const ROOT = process.cwd();
const SOURCE_ROOTS = ["apps", "packages"];
const GENERATED_SUFFIXES = [".js", ".js.map", ".d.ts.map"];
const ALLOWED_DTS = new Set(["vite-env.d.ts", "ogl.d.ts"]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") {
        continue;
      }
      files.push(...(await walk(fullPath)));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

async function hasMatchingSource(dtsPath) {
  const base = dtsPath.slice(0, -".d.ts".length);
  for (const extension of [".ts", ".tsx"]) {
    try {
      await stat(`${base}${extension}`);
      return true;
    } catch {
      // Continue checking other extensions.
    }
  }
  return false;
}

async function collectViolations() {
  const violations = [];

  for (const sourceRoot of SOURCE_ROOTS) {
    const absoluteRoot = path.join(ROOT, sourceRoot);
    let files = [];

    try {
      files = await walk(absoluteRoot);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    for (const file of files) {
      const relativePath = path.relative(ROOT, file).replaceAll("\\", "/");
      const inSrcTree = relativePath.includes("/src/");

      if (inSrcTree) {
        for (const suffix of GENERATED_SUFFIXES) {
          if (relativePath.endsWith(suffix)) {
            violations.push(relativePath);
            break;
          }
        }

        if (relativePath.endsWith(".d.ts") && !ALLOWED_DTS.has(path.basename(relativePath))) {
          if (await hasMatchingSource(file)) {
            violations.push(relativePath);
          }
        }
        continue;
      }

      if (
        relativePath.endsWith("vite.config.js") ||
        relativePath.endsWith("vite.config.d.ts") ||
        relativePath.endsWith("vite.config.js.map") ||
        relativePath.endsWith("vite.config.d.ts.map")
      ) {
        violations.push(relativePath);
      }
    }
  }

  return violations;
}

const violations = await collectViolations();

if (violations.length > 0) {
  console.error("Generated artifacts must not be tracked under source directories:");
  for (const violation of violations.sort()) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log("No generated source artifacts found.");

await runPaymentLeakCheck();
