import { logger } from "./logger.js";

export interface ShutdownDeps {
  /** Stop accepting new connections and resolve once the server has closed. */
  closeServer: () => Promise<void>;
  /** Close database handles. Safe to call even when nothing is open. */
  closeDb: () => void;
  /** Milliseconds to wait for a clean shutdown before forcing exit. */
  timeoutMs?: number;
  /** Injectable for tests; defaults to `process.exit`. */
  exit?: (code: number) => void;
  /** Injectable signal hook for tests; defaults to `process.once`. */
  onSignal?: (signal: NodeJS.Signals, handler: () => void) => void;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Registers an idempotent SIGTERM/SIGINT shutdown path: stop accepting new
 * requests, close the HTTP server, then close the database exactly once —
 * bounded by `timeoutMs` so a stuck close can't hang the process forever.
 * Only the forced-timeout and error paths exit non-zero; a clean shutdown
 * lets the process exit on its own once the event loop drains.
 */
export function registerShutdown(deps: ShutdownDeps): void {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const onSignal = deps.onSignal ?? ((signal, handler) => process.once(signal, handler));

  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, "shutdown signal received; draining");

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      logger.error({ signal, timeoutMs }, "shutdown exceeded bounded timeout; forcing exit");
      exit(1);
    }, timeoutMs);
    timer.unref?.();

    try {
      await deps.closeServer();
      deps.closeDb();
      clearTimeout(timer);
      if (!timedOut) {
        logger.info({ signal }, "shutdown complete");
      }
    } catch (error) {
      clearTimeout(timer);
      if (!timedOut) {
        logger.error({ signal, error }, "shutdown failed");
        exit(1);
      }
    }
  }

  onSignal("SIGTERM", () => void shutdown("SIGTERM"));
  onSignal("SIGINT", () => void shutdown("SIGINT"));
}
