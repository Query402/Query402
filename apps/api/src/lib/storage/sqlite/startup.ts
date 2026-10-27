import { config } from "../../config.js";
import { logger } from "../../logger.js";
import {
  MigrationError,
  closeAnalyticsDb,
  expectedSchemaVersion,
  getAnalyticsDb,
  isSchemaCurrent
} from "./store.js";

export interface ClosableServer {
  close: (callback?: (err?: Error) => void) => unknown;
}

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export function bootApi<TServer = void>(deps: {
  openDatabase?: () => void;
  listen: () => TServer;
}): { listening: boolean; failedVersion: number | null; server: TServer | null } {
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
    return { listening: false, failedVersion, server: null };
  }

  const server = deps.listen();
  return { listening: true, failedVersion: null, server: server ?? null };
}

export function createGracefulShutdown(deps: {
  server?: ClosableServer | null;
  closeDatabase?: () => void;
  exit?: (code: number) => void;
  timeoutMs?: number;
}): (signal?: NodeJS.Signals | string) => Promise<number> {
  const closeDatabase = deps.closeDatabase ?? closeAnalyticsDb;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

  let shutdownPromise: Promise<number> | null = null;
  let dbClosed = false;

  const closeDatabaseOnce = (): Error | null => {
    if (dbClosed) {
      return null;
    }
    dbClosed = true;
    try {
      closeDatabase();
      return null;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  };

  return (signal = "SIGTERM"): Promise<number> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    logger.info({ signal }, "Shutting down Query402 API");

    shutdownPromise = new Promise<number>((resolve) => {
      let settled = false;

      const finish = (exitCode: number) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (exitCode !== 0) {
          exit(exitCode);
        }
        resolve(exitCode);
      };

      const timer = setTimeout(() => {
        logger.error({ signal, timeoutMs }, "Graceful shutdown timed out; forcing exit");
        closeDatabaseOnce();
        finish(1);
      }, timeoutMs);
      timer.unref?.();

      if (!deps.server) {
        const dbErr = closeDatabaseOnce();
        if (dbErr) {
          logger.error({ err: dbErr }, "Failed to close analytics database during shutdown");
          finish(1);
          return;
        }
        finish(0);
        return;
      }

      try {
        deps.server.close((closeErr?: Error) => {
          const dbErr = closeDatabaseOnce();
          if (closeErr || dbErr) {
            logger.error(
              { err: closeErr ?? dbErr },
              "Error while closing HTTP server or analytics database"
            );
            finish(1);
            return;
          }
          finish(0);
        });
      } catch (error) {
        logger.error({ err: error }, "Unexpected error initiating server close");
        closeDatabaseOnce();
        finish(1);
      }
    });

    return shutdownPromise;
  };
}

export function registerShutdownHandlers(deps: {
  server?: ClosableServer | null;
  closeDatabase?: () => void;
  exit?: (code: number) => void;
  timeoutMs?: number;
  processTarget?: Pick<NodeJS.Process, "once" | "off">;
}): {
  shutdown: (signal?: NodeJS.Signals | string) => Promise<number>;
  dispose: () => void;
} {
  const target = deps.processTarget ?? process;
  const shutdown = createGracefulShutdown(deps);

  const onSigterm = () => {
    void shutdown("SIGTERM");
  };
  const onSigint = () => {
    void shutdown("SIGINT");
  };

  target.once("SIGTERM", onSigterm);
  target.once("SIGINT", onSigint);

  return {
    shutdown,
    dispose: () => {
      target.off("SIGTERM", onSigterm);
      target.off("SIGINT", onSigint);
    }
  };
}
