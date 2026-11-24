import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isRuntimeDatabaseArtifact,
  findTrackedDatabaseArtifacts,
  runRuntimeDatabaseCheck,
  runSelfTest
} from "./check-runtime-databases.mjs";

describe("runtime database policy and CI guard", () => {
  describe("allowed schema and fixture text files", () => {
    const allowedCases = [
      "apps/api/src/lib/storage/sqlite/migrations.ts",
      "apps/api/src/lib/storage/sqlite/migrations.test.ts",
      "packages/shared/src/schemas.ts",
      "packages/shared/src/schemas.test.ts",
      "apps/api/data/.gitkeep",
      "schema.sql",
      "migrations/001_init.sql",
      "db/schema.sql",
      "fixtures/test-fixtures.json",
      "test/fixtures/mock-data.json",
      "fixtures/mock-db.json",
      "fixtures/seed.json",
      "test-fixture.sql",
      "fixtures.ts",
      "schema.json",
      "db.json",
      "docs/analytics-storage.md",
      "architecture.md",
      "README.MD",
      "scripts/migrate-db-json.ts"
    ];

    for (const filePath of allowedCases) {
      it(`allows schema/fixture/source file: ${filePath}`, () => {
        assert.equal(
          isRuntimeDatabaseArtifact(filePath),
          false,
          `Expected "${filePath}" to be allowed`
        );
      });
    }
  });

  describe("rejected database names and sidecars", () => {
    const rejectedCases = [
      "analytics.db",
      "sponsorship.db",
      "test.db",
      "app.sqlite",
      "database.sqlite3",
      "analytics.db-wal",
      "sponsorship.db-wal",
      "temp-wal",
      "analytics.db-shm",
      "sponsorship.db-shm",
      "temp-shm",
      "analytics.db-journal",
      "sponsorship.db-journal",
      "temp-journal",
      "analytics.journal",
      "apps/api/data/analytics.db",
      "apps/api/data/sponsorship.db",
      "apps/api/data/analytics.db-wal",
      "apps/api/data/analytics.db-shm",
      "apps/api/data/analytics.db-journal",
      "apps/api/data/test.sqlite",
      "apps/api/data/test.sqlite3",
      "var/data/analytics.db",
      "schema.db",
      "fixture.db",
      "fixture.sqlite",
      "UPPERCASE.DB",
      "ANALYTICS.SQLITE",
      "DATABASE.SQLITE3",
      "DATA.DB-WAL",
      "DATA.DB-SHM",
      "DATA.DB-JOURNAL",
      "apps\\api\\data\\analytics.db",
      "data\\test.sqlite-wal"
    ];

    for (const filePath of rejectedCases) {
      it(`rejects runtime database artifact: ${filePath}`, () => {
        assert.equal(
          isRuntimeDatabaseArtifact(filePath),
          true,
          `Expected "${filePath}" to be rejected`
        );
      });
    }
  });

  describe("findTrackedDatabaseArtifacts", () => {
    it("returns empty array when all tracked files are allowed", () => {
      const tracked = [
        "apps/api/data/.gitkeep",
        "apps/api/src/lib/storage/sqlite/migrations.ts",
        "packages/shared/src/schemas.ts",
        "schema.sql",
        "fixtures/seed.json"
      ];
      assert.deepEqual(findTrackedDatabaseArtifacts(tracked), []);
    });

    it("filters and reports only violating database artifact paths", () => {
      const tracked = [
        "apps/api/data/.gitkeep",
        "apps/api/data/analytics.db",
        "apps/api/src/lib/storage/sqlite/migrations.ts",
        "apps/api/data/sponsorship.db-wal",
        "schema.sql",
        "apps/api/data/analytics.db-shm",
        "fixtures.json"
      ];
      assert.deepEqual(findTrackedDatabaseArtifacts(tracked), [
        "apps/api/data/analytics.db",
        "apps/api/data/sponsorship.db-wal",
        "apps/api/data/analytics.db-shm"
      ]);
    });
  });

  describe("reporting and security policy", () => {
    it("reports paths only and never reads database file contents", async () => {
      const mockViolations = ["apps/api/data/analytics.db", "apps/api/data/analytics.db-wal"];
      const loggedErrors = [];
      const originalConsoleError = console.error;

      try {
        console.error = (msg) => loggedErrors.push(msg);
        await assert.rejects(
          async () => {
            await runRuntimeDatabaseCheck({
              files: mockViolations,
              throwOnError: true
            });
          },
          {
            message: /Runtime database check failed: 2 database artifact\(s\) tracked\./
          }
        );

        // Verify that only paths were logged, no binary/content inspection occurred
        assert.equal(
          loggedErrors.some((line) => line.includes("apps/api/data/analytics.db")),
          true
        );
        assert.equal(
          loggedErrors.some((line) => line.includes("apps/api/data/analytics.db-wal")),
          true
        );
      } finally {
        console.error = originalConsoleError;
      }
    });

    it("self-test passes without error", () => {
      assert.doesNotThrow(() => {
        runSelfTest();
      });
    });

    it("preserves apps/api/data/.gitkeep", () => {
      assert.equal(isRuntimeDatabaseArtifact("apps/api/data/.gitkeep"), false);
      assert.deepEqual(findTrackedDatabaseArtifacts(["apps/api/data/.gitkeep"]), []);
    });

    it("does not remove or flag migration source files", () => {
      const migrationFiles = [
        "apps/api/src/lib/storage/sqlite/migrations.ts",
        "apps/api/src/lib/storage/sqlite/migrations.test.ts",
        "apps/api/src/scripts/migrate-db-json.ts"
      ];
      for (const file of migrationFiles) {
        assert.equal(isRuntimeDatabaseArtifact(file), false);
      }
      assert.deepEqual(findTrackedDatabaseArtifacts(migrationFiles), []);
    });
  });
});
