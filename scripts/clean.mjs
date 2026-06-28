import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const WORKSPACE_ROOTS = ["apps", "packages"];
const ARTIFACT_DIR_NAMES = new Set(["dist", "coverage"]);
const API_DATA_DIR = path.join(ROOT, "apps/api/data");
const API_RUNTIME_FILE_PATTERN = /\.(db(?:-wal|-shm)?|json)$/;
const PRESERVED_API_DATA_ENTRIES = new Set([".gitkeep"]);

async function removePath(targetPath) {
  try {
    await rm(targetPath, { recursive: true, force: true });
    console.log(`Removed ${path.relative(ROOT, targetPath).replaceAll("\\", "/")}`);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function removeArtifactDirs(dir) {
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "node_modules") {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (ARTIFACT_DIR_NAMES.has(entry.name)) {
      await removePath(fullPath);
      continue;
    }

    await removeArtifactDirs(fullPath);
  }
}

async function cleanApiData() {
  let entries;

  try {
    entries = await readdir(API_DATA_DIR, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (PRESERVED_API_DATA_ENTRIES.has(entry.name)) {
      continue;
    }

    if (!entry.isFile() || !API_RUNTIME_FILE_PATTERN.test(entry.name)) {
      continue;
    }

    await removePath(path.join(API_DATA_DIR, entry.name));
  }
}

async function main() {
  for (const artifactDir of ARTIFACT_DIR_NAMES) {
    await removePath(path.join(ROOT, artifactDir));
  }

  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const absoluteRoot = path.join(ROOT, workspaceRoot);

    try {
      await stat(absoluteRoot);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    await removeArtifactDirs(absoluteRoot);
  }

  await cleanApiData();
  console.log("Clean complete.");
}

await main();
