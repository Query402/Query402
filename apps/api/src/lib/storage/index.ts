import { config } from "../config.js";
import type { StorageRepository } from "./types.js";
import { createInMemoryStorageRepository } from "./memory.js";
import { createSqliteStorageRepository } from "./sqlite/repository.js";
import { closeAnalyticsDb } from "./sqlite/store.js";

export type { StorageRepository } from "./types.js";
export { createInMemoryStorageRepository } from "./memory.js";
export { createSqliteStorageRepository } from "./sqlite/repository.js";
export { resolveApiDataPath } from "./paths.js";
export { closeAnalyticsDb } from "./sqlite/store.js";
export {
  JsonMigrationCollisionError,
  discoverLegacyDbJsonPaths,
  formatMigrationResult,
  migrateLegacyJsonToSqlite,
  parseLegacyDbJson,
  readLegacyDbJson
} from "./migrate-json.js";
export type {
  JsonMigrationOptions,
  JsonMigrationResult,
  LegacyDbJson,
  MigrationCollisionKind,
  MigrationCollisionScope,
  MigrationCollisionTable
} from "./migrate-json.js";

let repository: StorageRepository | null = null;

function createDefaultRepository(): StorageRepository {
  if (config.analyticsStorage === "memory") {
    return createInMemoryStorageRepository();
  }

  return createSqliteStorageRepository(config.analyticsDbPath);
}

export function setStorageRepository(next: StorageRepository | null): void {
  if (repository) {
    repository.close();
  }
  repository = next;
}

export function getStorageRepository(): StorageRepository {
  if (!repository) {
    repository = createDefaultRepository();
  }

  return repository;
}

export function isStorageAvailable(): boolean {
  try {
    return getStorageRepository().isAvailable();
  } catch {
    return false;
  }
}

export function closeStorageRepository(): void {
  if (repository) {
    repository.close();
    repository = null;
  } else {
    closeAnalyticsDb();
  }
}
