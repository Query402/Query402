import path from "node:path";
import {
  assertTargetDbIsEmpty,
  discoverLegacyDbJsonPaths,
  formatMigrationResult,
  migrateLegacyJsonToSqlite
} from "../lib/storage/migrate-json.js";
import { resolveApiDataPath, resolveConfinedDataPath } from "../lib/storage/paths.js";

interface CliOptions {
  sourcePath?: string;
  targetPath: string;
  dryRun: boolean;
  archiveSource: boolean;
  force: boolean;
}

function defaultTargetPath(): string {
  const configured = process.env.ANALYTICS_DB_PATH?.trim();
  return resolveApiDataPath(configured || "data/analytics.db");
}

function printUsage(): void {
  console.log(`Usage: migrate-db-json [options]

One-time migration from legacy db.json to SQLite analytics storage.

Options:
  --source <path>   Legacy db.json path (auto-discovered if omitted)
  --target <path>   Target SQLite path (default: ANALYTICS_DB_PATH or data/analytics.db)
  --dry-run         Validate and report counts without writing
  --archive         Rename source file after successful migration
  --force           Allow merging into a non-empty target database (collisions abort)
  --help            Show this help message
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    targetPath: defaultTargetPath(),
    dryRun: false,
    archiveSource: false,
    force: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--archive":
        options.archiveSource = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--source":
        options.sourcePath = path.resolve(argv[index + 1] ?? "");
        index += 1;
        break;
      case "--target":
        options.targetPath = path.resolve(argv[index + 1] ?? "");
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function resolveSourcePath(explicitPath?: string): string {
  if (explicitPath) {
    return explicitPath;
  }

  const discovered = discoverLegacyDbJsonPaths();
  if (discovered.length === 0) {
    throw new Error("No legacy db.json found. Pass --source <path> explicitly.");
  }

  if (discovered.length > 1) {
    console.warn(`Multiple legacy db.json files found; using ${discovered[0]}`);
    console.warn(`Candidates: ${discovered.join(", ")}`);
  }

  return discovered[0];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  options.targetPath = resolveConfinedDataPath(options.targetPath);
  if (options.sourcePath) {
    options.sourcePath = resolveConfinedDataPath(options.sourcePath);
  }
  const sourcePath = resolveSourcePath(options.sourcePath);
  resolveConfinedDataPath(sourcePath);

  if (!options.dryRun && !options.force) {
    assertTargetDbIsEmpty(options.targetPath);
  }

  const result = migrateLegacyJsonToSqlite({
    sourcePath,
    targetPath: options.targetPath,
    dryRun: options.dryRun,
    archiveSource: options.archiveSource && !options.dryRun
  });

  console.log(formatMigrationResult(result));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Migration failed: ${message}`);
  process.exit(1);
});
