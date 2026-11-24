import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, closeAnalyticsDb, expectedSchemaVersion, getAnalyticsDb, MigrationError } from "./store.js";
import { bootApi } from "./startup.js";

describe("sqlite migrations", () => {
  const directories: string[] = [];

  afterEach(() => {
    closeAnalyticsDb();
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    delete process.env.QUERY402_DATA_DIR;
    vi.restoreAllMocks();
  });

  function tempDir(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "query402-migrate-"));
    directories.push(directory);
    process.env.QUERY402_DATA_DIR = directory;
    return directory;
  }

  it("migrates a clean database to the latest version and can start", () => {
    const directory = tempDir();
    const dbPath = path.join(directory, "clean.db");
    const database = getAnalyticsDb(dbPath);
    const row = database.prepare(`SELECT MAX(version) AS version FROM schema_migrations`).get() as {
      version: number;
    };
    expect(row.version).toBe(expectedSchemaVersion());

    let listened = false;
    const booted = bootApi({
      openDatabase: () => {
        getAnalyticsDb(dbPath);
      },
      listen: () => {
        listened = true;
      }
    });

    expect(booted.listening).toBe(true);
    expect(listened).toBe(true);
  });

  it("leaves the previous version applied when a middle migration fails", () => {
    const directory = tempDir();
    const database = new Database(path.join(directory, "partial.db"));

    expect(() =>
      applyMigrations(database, [
        { version: 1, sql: "CREATE TABLE kept (id INTEGER);" },
        { version: 2, sql: "NOT VALID SQL;" },
        { version: 3, sql: "CREATE TABLE later (id INTEGER);" }
      ])
    ).toThrow(MigrationError);

    const versions = database.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all() as {
      version: number;
    }[];
    expect(versions.map((row) => row.version)).toEqual([1]);
    expect(database.prepare(`SELECT name FROM sqlite_master WHERE name = 'later'`).get()).toBeUndefined();
    database.close();
  });

  it("does not listen when a migration fails", () => {
    let listened = false;
    const booted = bootApi({
      openDatabase: () => {
        throw new MigrationError(2);
      },
      listen: () => {
        listened = true;
      }
    });

    expect(booted.listening).toBe(false);
    expect(booted.failedVersion).toBe(2);
    expect(listened).toBe(false);
  });
});
