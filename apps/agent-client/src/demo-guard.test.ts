import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertApiDemoMode,
  buildApiHealthUrl,
  DemoModeDisabledError,
  fetchApiDemoMode,
  isApiDemoModeSnapshot,
  DEMO_MODE_PROBE_TIMEOUT_MS
} from "./demo-guard.js";

const SECRET_SENTINEL =
  "SBU4V2PLOHV6J3Z3W2N3M3K3L3J3H3G3F3E3D3C3B3A393837363534XXX".replace("XXX", "AB3D");

function healthResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function fetchReturning(body: unknown, status = 200) {
  return vi.fn(async () => healthResponse(body, status)) as unknown as typeof fetch;
}

describe("buildApiHealthUrl", () => {
  it("appends /health to a bare base URL", () => {
    expect(buildApiHealthUrl("http://localhost:3001")).toBe("http://localhost:3001/health");
  });

  it("strips trailing slashes from the base URL", () => {
    expect(buildApiHealthUrl("https://api.example.com///")).toBe("https://api.example.com/health");
  });
});

describe("isApiDemoModeSnapshot", () => {
  it("accepts objects with a boolean demoMode", () => {
    expect(isApiDemoModeSnapshot({ demoMode: true })).toBe(true);
    expect(isApiDemoModeSnapshot({ demoMode: false })).toBe(true);
  });

  it("rejects missing or non-boolean demoMode", () => {
    expect(isApiDemoModeSnapshot({})).toBe(false);
    expect(isApiDemoModeSnapshot({ demoMode: "true" })).toBe(false);
    expect(isApiDemoModeSnapshot(null)).toBe(false);
    expect(isApiDemoModeSnapshot("demo")).toBe(false);
  });
});

describe("fetchApiDemoMode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns true when the API health endpoint reports demoMode=true", async () => {
    const fetchImpl = fetchReturning({ ok: true, demoMode: true });
    await expect(fetchApiDemoMode(fetchImpl, "http://localhost:3001")).resolves.toBe(true);
  });

  it("returns false when the API health endpoint reports demoMode=false", async () => {
    const fetchImpl = fetchReturning({ ok: true, demoMode: false });
    await expect(fetchApiDemoMode(fetchImpl, "http://localhost:3001")).resolves.toBe(false);
  });

  it("probes GET /health without credentials or payment material", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("x-payment")).toBeNull();
      expect(headers.get("payment")).toBeNull();
      return healthResponse({ demoMode: true });
    }) as unknown as typeof fetch;

    await expect(fetchApiDemoMode(fetchImpl, "http://localhost:3001")).resolves.toBe(true);
  });

  it("throws a secret-free error when the health endpoint is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(fetchApiDemoMode(fetchImpl, "http://127.0.0.1:65535")).rejects.toThrow(
      /Unable to reach Query402 API at http:\/\/127\.0\.0\.1:65535 to read the demo mode flag/
    );
  });

  it("throws when the health endpoint returns a non-OK status", async () => {
    const fetchImpl = fetchReturning({ error: "boom" }, 500);
    await expect(fetchApiDemoMode(fetchImpl, "http://localhost:3001")).rejects.toThrow(
      /health endpoint returned status 500/
    );
  });

  it("throws when the health response is not JSON", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("<html>oops</html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })
    ) as unknown as typeof fetch;

    await expect(fetchApiDemoMode(fetchImpl, "http://localhost:3001")).rejects.toThrow(
      /non-JSON health response/
    );
  });

  it("throws when the health response omits a boolean demoMode", async () => {
    const fetchImpl = fetchReturning({ ok: true });
    await expect(fetchApiDemoMode(fetchImpl, "http://localhost:3001")).rejects.toThrow(
      /did not report a boolean demoMode flag/
    );
  });

  it("surfaces probe errors without echoing config secrets", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    let error: Error | undefined;
    try {
      await fetchApiDemoMode(fetchImpl, "http://localhost:3001");
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).not.toContain(SECRET_SENTINEL);
  });
});

describe("assertApiDemoMode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves when demo mode is on and never throws", async () => {
    const fetchImpl = fetchReturning({ demoMode: true });
    await expect(assertApiDemoMode(fetchImpl, "http://localhost:3001")).resolves.toBeUndefined();
  });

  it("throws DemoModeDisabledError when the API is not in demo mode", async () => {
    const fetchImpl = fetchReturning({ demoMode: false });
    await expect(assertApiDemoMode(fetchImpl, "http://localhost:3001")).rejects.toThrow(
      DemoModeDisabledError
    );
  });

  it("explains that the demo refuses to run against a paid API", async () => {
    const fetchImpl = fetchReturning({ demoMode: false });

    let error: DemoModeDisabledError | undefined;
    try {
      await assertApiDemoMode(fetchImpl, "http://localhost:3001");
    } catch (e) {
      error = e as DemoModeDisabledError;
    }

    expect(error).toBeInstanceOf(DemoModeDisabledError);
    expect(error?.message).toContain("not in demo mode");
    expect(error?.message).toContain("refuses to run against a paid API");
  });

  it("does not include any secret material in the error message", async () => {
    const fetchImpl = fetchReturning({ demoMode: false });

    let error: DemoModeDisabledError | undefined;
    try {
      await assertApiDemoMode(fetchImpl, "http://localhost:3001");
    } catch (e) {
      error = e as DemoModeDisabledError;
    }

    expect(error?.message).not.toContain(SECRET_SENTINEL);
    expect(error?.message).not.toMatch(/Bearer /i);
    expect(error?.message).not.toMatch(/S[A-Z2-7]{55}/);
  });

  it("propagates probe failures as plain errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(assertApiDemoMode(fetchImpl, "http://localhost:3001")).rejects.toThrow(
      /Unable to reach Query402 API/
    );
  });
});

describe("probe timeout", () => {
  it("has a bounded, documented timeout", () => {
    expect(DEMO_MODE_PROBE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEMO_MODE_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it("aborts the probe when the API never responds", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("The operation was aborted");
              error.name = "AbortError";
              reject(error);
            });
          })
      ) as unknown as typeof fetch;

      const pending = fetchApiDemoMode(fetchImpl, "http://localhost:3001");
      const assertion = expect(pending).rejects.toThrow(/Unable to reach Query402 API/);
      await vi.advanceTimersByTimeAsync(DEMO_MODE_PROBE_TIMEOUT_MS + 1);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
