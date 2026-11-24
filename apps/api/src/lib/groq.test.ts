import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { fetchGroqItems } from "./groq.js";

const successBody = JSON.stringify({
  choices: [
    {
      message: {
        content: JSON.stringify([
          { title: "Result", url: "https://example.com", snippet: "Safe", score: 0.9 }
        ])
      }
    }
  ]
});

describe("Groq response bounds", () => {
  const previousApiKey = config.GROQ_API_KEY;

  beforeEach(() => {
    config.GROQ_API_KEY = "test-api-key";
  });

  afterEach(() => {
    config.GROQ_API_KEY = previousApiKey;
    vi.restoreAllMocks();
  });

  it("returns validated items from a bounded response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(successBody));

    await expect(fetchGroqItems("search", "safe query", { fetch })).resolves.toHaveLength(1);
  });

  it("actively aborts a stalled request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );

    await expect(
      fetchGroqItems("search", "private query", { fetch, timeoutMs: 5 })
    ).rejects.toThrow("Groq request timed out");
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("rejects an oversized response without exposing its content", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(`secret-${"x".repeat(64)}`));

    await expect(
      fetchGroqItems("search", "private query", { fetch, maxResponseBytes: 16 })
    ).rejects.toThrow("Groq response exceeded size limit");
  });

  it("does not include an upstream error body in the failure", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("upstream-secret", { status: 500 }));

    await expect(fetchGroqItems("search", "private query", { fetch })).rejects.toThrow(
      "Groq request failed (status 500)"
    );
  });
});
