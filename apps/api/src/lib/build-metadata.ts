import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readApiPackageJson(): { version: string } {
  const packagePath = path.join(API_PACKAGE_ROOT, "package.json");
  const raw = fs.readFileSync(packagePath, "utf-8");
  const parsed = JSON.parse(raw) as { version?: string };

  if (!parsed.version) {
    throw new Error(`Missing version in ${packagePath}`);
  }

  return { version: parsed.version };
}

function readGitCommit(): string | undefined {
  try {
    const gitPath = path.join(API_PACKAGE_ROOT, ".git", "HEAD");
    if (!fs.existsSync(gitPath)) {
      return undefined;
    }
    const head = fs.readFileSync(gitPath, "utf-8").trim();
    if (head.startsWith("ref:")) {
      const refPath = path.join(API_PACKAGE_ROOT, ".git", head.slice(5).trim());
      if (fs.existsSync(refPath)) {
        return fs.readFileSync(refPath, "utf-8").trim().slice(0, 7);
      }
    } else {
      return head.slice(0, 7);
    }
  } catch {
    return undefined;
  }
}

const packageInfo = readApiPackageJson();

export const apiVersion = packageInfo.version;
export const buildMetadata = {
  version: packageInfo.version,
  gitCommit: readGitCommit(),
  buildTime: process.env.BUILD_TIME
};
