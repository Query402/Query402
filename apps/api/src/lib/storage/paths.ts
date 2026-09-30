import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export class StoragePathError extends Error {
  constructor() {
    super("Storage path is outside the data directory");
    this.name = "StoragePathError";
  }
}

export function configuredDataDirectory(): string {
  const fromEnv = process.env.QUERY402_DATA_DIR?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  return path.resolve(API_PACKAGE_ROOT, "data");
}

export function resolveApiDataPath(relativeOrAbsolute: string): string {
  if (path.isAbsolute(relativeOrAbsolute)) {
    return relativeOrAbsolute;
  }

  return path.resolve(API_PACKAGE_ROOT, relativeOrAbsolute);
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function realpathOrThrow(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    throw new StoragePathError();
  }
}

/**
 * Resolve a database or JSON path and require the real path to stay inside
 * the data directory. Rejects `..`, absolute escapes, and symlinks that
 * point outside. The error never includes file contents.
 */
export function resolveConfinedDataPath(candidate: string, dataDirectory = configuredDataDirectory()): string {
  if (!candidate || candidate.includes("\0")) {
    throw new StoragePathError();
  }

  fs.mkdirSync(dataDirectory, { recursive: true });
  const root = realpathOrThrow(path.resolve(dataDirectory));
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(API_PACKAGE_ROOT, candidate);

  const parts: string[] = [];
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      throw new StoragePathError();
    }
    parts.unshift(path.basename(ancestor));
    ancestor = parent;
  }

  const realAncestor = realpathOrThrow(ancestor);
  const finalPath = parts.length > 0 ? path.join(realAncestor, ...parts) : realAncestor;
  if (!isInside(root, finalPath)) {
    throw new StoragePathError();
  }

  return finalPath;
}
