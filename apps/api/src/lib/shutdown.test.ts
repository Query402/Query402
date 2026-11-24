import { describe, expect, it, vi } from "vitest";
import { registerShutdown, type ShutdownDeps } from "./shutdown.js";

function setup(overrides: Partial<ShutdownDeps> = {}) {
  const handlers: Partial<Record<NodeJS.Signals, () => void>> = {};
  const onSignal = vi.fn((signal: NodeJS.Signals, handler: () => void) => {
    handlers[signal] = handler;
  });
  const closeServer = vi.fn().mockResolvedValue(undefined);
  const closeDb = vi.fn();
  const exit = vi.fn();

  registerShutdown({
    closeServer,
    closeDb,
    exit,
    onSignal,
    timeoutMs: 50,
    ...overrides
  });

  return { handlers, closeServer, closeDb, exit };
}

describe("registerShutdown", () => {
  it("registers handlers for both SIGTERM and SIGINT", () => {
    const { handlers } = setup();

    expect(typeof handlers.SIGTERM).toBe("function");
    expect(typeof handlers.SIGINT).toBe("function");
  });

  it("closes the server then the database exactly once on SIGTERM", async () => {
    const { handlers, closeServer, closeDb, exit } = setup();

    handlers.SIGTERM?.();
    await vi.waitFor(() => expect(closeDb).toHaveBeenCalledTimes(1));

    expect(closeServer).toHaveBeenCalledTimes(1);
    expect(closeDb).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it("is idempotent: a second signal during shutdown is a no-op", async () => {
    const { handlers, closeServer, closeDb } = setup();

    handlers.SIGTERM?.();
    handlers.SIGINT?.();
    await vi.waitFor(() => expect(closeDb).toHaveBeenCalledTimes(1));

    expect(closeServer).toHaveBeenCalledTimes(1);
    expect(closeDb).toHaveBeenCalledTimes(1);
  });

  it("forces a non-zero exit when shutdown exceeds the bounded timeout", async () => {
    const closeServer = vi.fn(() => new Promise<void>(() => {}));
    const { handlers, exit } = setup({ closeServer });

    handlers.SIGTERM?.();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it("exits non-zero when closing the server or database fails", async () => {
    const closeServer = vi.fn().mockRejectedValue(new Error("boom"));
    const { handlers, exit } = setup({ closeServer });

    handlers.SIGTERM?.();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});
