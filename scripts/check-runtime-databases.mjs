import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();

/**
 * Checks whether a given path is considered a runtime database artifact or sidecar.
 *
 * Rejects:
 *   - *.db
 *   - *.sqlite
 *   - *.sqlite3
 *   - *-wal, *.wal
 *   - *-shm, *.shm
 *   - *-journal, *.journal, *-mj*
 *
 * Allows:
 *   - apps/api/data/.gitkeep
 *   - Schema/fixture text files (*.sql, *.json, *.ts, *.js, *.txt, etc.)
 *   - Migration source files (*.ts, *.sql)
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function isRuntimeDatabaseArtifact(filePath) {
  if (!filePath || typeof filePath !== "string") {
    return false;
  }

  const normalized = filePath.replaceAll("\\", "/").trim();
  const basename = path.basename(normalized).toLowerCase();

  // Explicitly preserve .gitkeep
  if (basename === ".gitkeep") {
    return false;
  }

  // SQLite database files
  if (basename.endsWith(".db") || basename.endsWith(".sqlite") || basename.endsWith(".sqlite3")) {
    return true;
  }

  // WAL sidecars
  if (basename.endsWith("-wal") || basename.endsWith(".wal")) {
    return true;
  }

  // SHM sidecars
  if (basename.endsWith("-shm") || basename.endsWith(".shm")) {
    return true;
  }

  // Journal sidecars (rollback journal, master journal)
  if (
    basename.endsWith("-journal") ||
    basename.endsWith(".journal") ||
    /-mj[0-9a-fA-F]+$/i.test(basename)
  ) {
    return true;
  }

  return false;
}

/**
 * Retrieves the list of tracked files in the git repository.
 *
 * @param {string} [cwd=ROOT]
 * @returns {string[]}
 */
export function getTrackedFiles(cwd = ROOT) {
  try {
    const stdout = execSync("git ls-files", { cwd, encoding: "utf8" });
    return stdout.split(/\r?\n/).filter(Boolean);
  } catch (error) {
    throw new Error(`Failed to list tracked files via git: ${error.message}`);
  }
}

/**
 * Finds all tracked database artifacts.
 * Accepts an optional array of file paths for deterministic testing.
 *
 * @param {string[]|null} [files=null]
 * @returns {string[]} Array of violating file paths
 */
export function findTrackedDatabaseArtifacts(files = null) {
  const fileList = files ?? getTrackedFiles();
  return fileList.filter((file) => isRuntimeDatabaseArtifact(file));
}

export function runSelfTest() {
  const allowedTestCases = [
    "apps/api/data/.gitkeep",
    "apps/api/src/lib/storage/sqlite/migrations.ts",
    "apps/api/src/lib/storage/sqlite/migrations.test.ts",
    "packages/shared/src/schemas.ts",
    "packages/shared/src/schemas.test.ts",
    "schema.sql",
    "migrations/001_init.sql",
    "db/schema.sql",
    "fixtures/test-fixtures.json",
    "fixtures/mock-db.json",
    "fixtures/seed.json",
    "fixture.sql",
    "fixtures.ts",
    "test-fixtures.json",
    "schema.json",
    "docs/analytics-storage.md",
    "architecture.md",
    "README.MD",
    "scripts/migrate-db-json.ts"
  ];

  const rejectedDatabaseCases = [
    "analytics.db",
    "sponsorship.db",
    "test.db",
    "database.sqlite",
    "mydb.sqlite3",
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
    "DATA.DB-JOURNAL"
  ];

  for (const testPath of allowedTestCases) {
    if (isRuntimeDatabaseArtifact(testPath)) {
      console.error(
        `Self-test failed: Expected "${testPath}" to be allowed, but it was flagged as database artifact.`
      );
      process.exit(1);
    }
  }

  for (const testPath of rejectedDatabaseCases) {
    if (!isRuntimeDatabaseArtifact(testPath)) {
      console.error(
        `Self-test failed: Expected "${testPath}" to be rejected as database artifact, but it was allowed.`
      );
      process.exit(1);
    }
  }
}

/**
 * Runs the runtime database guard check.
 * Reports paths only; never reads or prints database contents.
 *
 * @param {Object} [options]
 * @param {string[]} [options.files]
 * @param {boolean} [options.throwOnError=false]
 */
export async function runRuntimeDatabaseCheck(options = {}) {
  // Always run self-test
  runSelfTest();

  if (process.argv.includes("--self-test")) {
    console.log("Runtime database check self-test passed successfully!");
    return;
  }

  const violations = findTrackedDatabaseArtifacts(options.files);

  if (violations.length > 0) {
    console.error("Runtime database artifacts must not be tracked in the repository:");
    for (const violation of violations.sort()) {
      console.error(`  - ${violation}`);
    }
    if (options.throwOnError) {
      throw new Error(
        `Runtime database check failed: ${violations.length} database artifact(s) tracked.`
      );
    }
    process.exit(1);
  }

  console.log("No tracked runtime database artifacts found.");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runRuntimeDatabaseCheck().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
