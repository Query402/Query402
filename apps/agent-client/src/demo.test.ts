import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoModeDisabledError as DemoModeDisabledGuard } from "./demo-guard.js";

/**
 * Demo-flow regression tests (Issue #177).
 *
 * The agent demo must read the target API's demo-mode flag BEFORE it
 * constructs any challenge/signer/payment. These tests stub the mode
 * endpoint (GET /health) and assert both directions:
 *
 *  - demo mode on  → the fixture client (runPaidQuery) is reached
 *  - demo mode off → the demo exits before any payment is built or signed
 *  - the refusal error never contains a secret
 */

process.env.API_BASE_URL = "http://localhost:3001";
process.env.DEMO_MODE = "true";

vi.mock("./client.js", () => ({
  runPaidQuery: vi.fn(async (input: { mode: string }) => ({
    endpoint: `http://localhost:3001/x402/${input.mode}`,
    status: 200,
    ok: true,
    isDemoMode: true,
    paymentResponse: "demo_tx_fixture",
    id: "idem-fixture",
    body: { result: { priceUsd: 0.01, items: [1, 2, 3] } },
    proofLinks: undefined
  }))
}));

const configState = vi.hoisted(() => ({ demoClientSecretKey: undefined as string | undefined }));

vi.mock("./config.js", () => ({
  config: {
    API_BASE_URL: "http://localhost:3001",
    DEMO_MODE: "true",
    get DEMO_CLIENT_SECRET_KEY() {
      return configState.demoClientSecretKey;
    }
  }
}));

function healthFetcher(demoMode: boolean) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, demoMode }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const SECRET_SENTINEL = "SAAS37XYAAS37XYAAS37XYAAS37XYAAS37XYAAS37XYAAS37XYAAS37XYAAS37XY";

async function loadDemo() {
  const mod = await import("./demo.js");
  return mod.runDemo;
}

describe("runDemo — demo-mode guard (Issue #177)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("demo mode on: probes /health first, then reaches the fixture client for every step", async () => {
    const runDemo = await loadDemo();
    const { impl, calls } = healthFetcher(true);

    await runDemo(impl);

    // The probe is the very first network call, GET, no credentials.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].url).toBe("http://localhost:3001/health");
    expect(calls[0].init?.method).toBe("GET");
    const probeHeaders = new Headers(calls[0].init?.headers);
    expect(probeHeaders.get("authorization")).toBeNull();
    expect(probeHeaders.get("x-payment")).toBeNull();

    const { runPaidQuery } = await import("./client.js");
    expect(runPaidQuery).toHaveBeenCalledTimes(3);
    expect(runPaidQuery).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "search", provider: "search.pro" })
    );
    expect(runPaidQuery).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "news", provider: "news.deep" })
    );
    expect(runPaidQuery).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "scrape", provider: "scrape.extract" })
    );

    // Fixture output is printed for each step.
    const output = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(output).toContain("Running search with search.pro");
    expect(output).toContain("Demo complete");
  });

  it("demo mode off: exits with a refusal BEFORE any paid request is attempted", async () => {
    const runDemo = await loadDemo();
    const { impl, calls } = healthFetcher(false);

    await expect(runDemo(impl)).rejects.toThrow(DemoModeDisabledGuard);

    const { runPaidQuery } = await import("./client.js");
    expect(runPaidQuery).not.toHaveBeenCalled();

    // Only the health probe was made — no /x402/ payment requests.
    for (const call of calls) {
      expect(call.url).not.toContain("/x402/");
    }
    expect(calls).toHaveLength(1);
  });

  it("demo mode off: no signature material is ever loaded", async () => {
    configState.demoClientSecretKey = SECRET_SENTINEL;
    try {
      const runDemo = await loadDemo();
      const { impl } = healthFetcher(false);

      await expect(runDemo(impl)).rejects.toThrow(/not in demo mode/);

      const { runPaidQuery } = await import("./client.js");
      expect(runPaidQuery).not.toHaveBeenCalled();
      // runPaidQuery is the only path that would construct the Ed25519
      // signer from DEMO_CLIENT_SECRET_KEY; it was never invoked, so no
      // signature material was touched.
    } finally {
      configState.demoClientSecretKey = undefined;
    }
  });

  it("refusal error never contains a payment header or a secret", async () => {
    configState.demoClientSecretKey = SECRET_SENTINEL;
    try {
      const runDemo = await loadDemo();
      const { impl } = healthFetcher(false);

      let error: Error | undefined;
      try {
        await runDemo(impl);
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeInstanceOf(DemoModeDisabledGuard);
      expect(String(error?.message)).not.toContain(SECRET_SENTINEL);
      expect(String(error?.message)).not.toMatch(/Bearer /i);
      expect(String(error?.message)).not.toMatch(/S[A-Z2-7]{55}/);
      expect(String(error?.message)).not.toMatch(/x-payment/i);
    } finally {
      configState.demoClientSecretKey = undefined;
    }
  });

  it("unreachable API: refuses to run and attempts no paid request", async () => {
    const runDemo = await loadDemo();
    const impl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(runDemo(impl)).rejects.toThrow(/Unable to reach Query402 API/);

    const { runPaidQuery } = await import("./client.js");
    expect(runPaidQuery).not.toHaveBeenCalled();
  });

  it("non-JSON health response: refuses to run and attempts no paid request", async () => {
    const runDemo = await loadDemo();
    const impl = vi.fn(
      async () =>
        new Response("<html>gateway error</html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })
    ) as unknown as typeof fetch;

    await expect(runDemo(impl)).rejects.toThrow(/non-JSON health response/);

    const { runPaidQuery } = await import("./client.js");
    expect(runPaidQuery).not.toHaveBeenCalled();
  });
});
