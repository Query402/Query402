import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { resolveConfinedDataPath } from "../paths.js";
import { MIGRATIONS } from "./migrations.js";
import { logger } from "../../logger.js";

let db: Database.Database | null = null;
let initError: Error | null = null;
let activeDbPath: string | null = null;

export function applyMigrations(
  database: Database.Database,
  migrations: { version: number; sql: string }[]
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedVersions = new Set(
    (
      database.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all() as {
        version: number;
      }[]
    ).map((row) => row.version)
  );

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    const apply = database.transaction(() => {
      database.exec(migration.sql);
      database
        .prepare(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`)
        .run(migration.version, new Date().toISOString());
    });

    try {
      apply();
    } catch (error) {
      throw new MigrationError(migration.version, error);
    }
  }
}

function runMigrations(database: Database.Database): void {
  applyMigrations(database, MIGRATIONS);
}

export class MigrationError extends Error {
  readonly version: number;

  constructor(version: number, cause?: unknown) {
    super(`SQLite migration ${version} failed`);
    this.name = "MigrationError";
    this.version = version;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export function expectedSchemaVersion(): number {
  return MIGRATIONS.at(-1)?.version ?? 0;
}

export function appliedSchemaVersion(database: Database.Database): number {
  const row = database.prepare(`SELECT MAX(version) AS version FROM schema_migrations`).get() as {
    version: number | null;
  };
  return row.version ?? 0;
}

export function isSchemaCurrent(dbPath: string): boolean {
  const database = getAnalyticsDb(dbPath);
  return appliedSchemaVersion(database) >= expectedSchemaVersion();
}

/**
 * Bounded so a brief WAL writer doesn't fail a concurrent transaction with
 * SQLITE_BUSY immediately; long enough to ride out normal contention
 * without ever hanging the process indefinitely.
 */
const BUSY_TIMEOUT_MS = 5_000;

/**
 * Restricts a newly created database file to owner-only access (0600) on
 * platforms that expose POSIX file modes. Windows ACLs don't map onto this
 * call the same way, so it's skipped there; the operational expectation on
 * Windows is that filesystem/OS-level access control is relied on instead.
 * Pre-existing files are left untouched, and failures here are never
 * logged with file contents or credentials — only the path.
 */
function restrictToOwnerIfNewlyCreated(confinedPath: string, fileExistedBefore: boolean): void {
  if (fileExistedBefore || process.platform === "win32") {
    return;
  }

  try {
    fs.chmodSync(confinedPath, 0o600);
  } catch (error) {
    logger.warn(
      { path: confinedPath, error: error instanceof Error ? error.message : String(error) },
      "could not restrict database file to owner-only permissions"
    );
  }
}

export function getAnalyticsDb(dbPath: string): Database.Database {
  if (db && activeDbPath === dbPath) {
    return db;
  }

  if (initError && activeDbPath === dbPath) {
    throw initError;
  }

  if (db) {
    db.close();
    db = null;
    initError = null;
  }

  let confinedPath: string;
  try {
    confinedPath = resolveConfinedDataPath(dbPath);
  } catch (error) {
    initError =
      error instanceof Error ? error : new Error("Storage path is outside the data directory");
    activeDbPath = dbPath;
    throw initError;
  }

  try {
    const directory = path.dirname(confinedPath);
    fs.mkdirSync(directory, { recursive: true });

    const fileExistedBefore = fs.existsSync(confinedPath);
    const database = new Database(confinedPath);
    restrictToOwnerIfNewlyCreated(confinedPath, fileExistedBefore);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    try {
      runMigrations(database);
    } catch (error) {
      database.close();
      throw error;
    }

    db = database;
    activeDbPath = dbPath;
    initError = null;
    return database;
  } catch (error) {
    initError = error instanceof Error ? error : new Error(String(error));
    throw initError;
  }
}

export function isAnalyticsDbAvailable(dbPath: string): boolean {
  try {
    getAnalyticsDb(dbPath);
    return true;
  } catch {
    return false;
  }
}

export function runInAnalyticsTransaction<T>(
  dbPath: string,
  fn: (database: Database.Database) => T
): T {
  const database = getAnalyticsDb(dbPath);
  const transaction = database.transaction(fn);
  return transaction(database);
}

export function closeAnalyticsDb(): void {
  if (db) {
    db.close();
    db = null;
  }

  activeDbPath = null;
  initError = null;
}
