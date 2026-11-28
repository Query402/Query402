import { config } from "../../config.js";
import { logger } from "../../logger.js";
import {
  MigrationError,
  expectedSchemaVersion,
  getAnalyticsDb,
  isSchemaCurrent
} from "./store.js";

export function bootApi(deps: {
  openDatabase?: () => void;
  listen: () => void;
}): { listening: boolean; failedVersion: number | null } {
  const openDatabase =
    deps.openDatabase ??
    (() => {
      if (config.analyticsStorage === "memory") {
        return;
      }
      getAnalyticsDb(config.analyticsDbPath);
      if (!isSchemaCurrent(config.analyticsDbPath)) {
        throw new MigrationError(expectedSchemaVersion());
      }
    });

  try {
    openDatabase();
  } catch (error) {
    const failedVersion = error instanceof MigrationError ? error.version : null;
    logger.error({ failedVersion }, "SQLite migration failed; refusing to listen");
    return { listening: false, failedVersion };
  }

  deps.listen();
  return { listening: true, failedVersion: null };
}
