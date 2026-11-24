import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAnalyticsDb, closeAnalyticsDb } from "./sqlite/store.js";
import { StoragePathError, resolveConfinedDataPath } from "./paths.js";

describe("confined storage paths", () => {
  const directories: string[] = [];

  afterEach(() => {
    closeAnalyticsDb();
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    delete process.env.QUERY402_DATA_DIR;
  });

  function tempDataDir(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "query402-confine-"));
    directories.push(directory);
    process.env.QUERY402_DATA_DIR = directory;
    return directory;
  }

  it("opens a path inside the data directory", () => {
    const directory = tempDataDir();
    const dbPath = path.join(directory, "analytics.db");

    const database = getAnalyticsDb(dbPath);
    expect(database.prepare(`SELECT 1 AS ok`).get()).toEqual({ ok: 1 });
  });

  it("does not open a path that escapes with ..", () => {
    const directory = tempDataDir();
    expect(() => resolveConfinedDataPath(path.join(directory, "..", "outside.db"), directory)).toThrow(
      StoragePathError
    );
    expect(() => getAnalyticsDb(path.join(directory, "..", "outside.db"))).toThrow(StoragePathError);
  });

  it("does not open a symlink that points outside the data directory", () => {
    const directory = tempDataDir();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "query402-outside-"));
    directories.push(outside);
    const outsideFile = path.join(outside, "secret.db");
    fs.writeFileSync(outsideFile, "secret-contents");
    const link = path.join(directory, "linked.db");
    fs.symlinkSync(outsideFile, link);

    expect(() => getAnalyticsDb(link)).toThrow(StoragePathError);
    try {
      getAnalyticsDb(link);
    } catch (error) {
      expect(error).toBeInstanceOf(StoragePathError);
      expect((error as Error).message).not.toContain("secret-contents");
    }
  });
});
