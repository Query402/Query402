import { afterEach, describe, expect, it, vi } from "vitest";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";
import {
  CatalogResponseError,
  MAX_CATALOG_RESPONSE_BYTES,
  parseProviderCatalog,
  readCatalogText
} from "./catalog.js";

const encoder = new TextEncoder();

function byteLength(text: string) {
  return encoder.encode(text).byteLength;
}

function chunkedResponse(chunks: string[], headers: Record<string, string> = {}) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
  return new Response(stream, { headers });
}

function padToExactSize(json: string, size: number) {
  const pad = size - byteLength(json);
  expect(pad).toBeGreaterThanOrEqual(0);
  return json + " ".repeat(pad);
}

const validCatalog = {
  providers: [{ id: "search.basic", priceUsd: 0.01, enabled: true }]
};

describe("readCatalogText", () => {
  it("accepts a response exactly at the byte limit", async () => {
    const body = padToExactSize(JSON.stringify(validCatalog), MAX_CATALOG_RESPONSE_BYTES);
    const response = chunkedResponse([body], {
      "content-length": String(MAX_CATALOG_RESPONSE_BYTES)
    });

    const text = await readCatalogText(response);
    expect(byteLength(text)).toBe(MAX_CATALOG_RESPONSE_BYTES);
    expect(parseProviderCatalog(text).providers).toHaveLength(1);
  });

  it("rejects an oversized Content-Length before reading the body", async () => {
    const response = chunkedResponse([JSON.stringify(validCatalog)], {
      "content-length": String(MAX_CATALOG_RESPONSE_BYTES + 1)
    });

    await expect(readCatalogText(response)).rejects.toMatchObject({
      name: "CatalogResponseError",
      code: "catalog_too_large"
    });
  });

  it("rejects a chunked response that streams past the limit", async () => {
    const chunk = "a".repeat(64 * 1024);
    const response = chunkedResponse(Array(9).fill(chunk));

    await expect(readCatalogText(response)).rejects.toBeInstanceOf(CatalogResponseError);
  });

  it("does not echo response body content in the error", async () => {
    const marker = "SECRET_PAYLOAD_MARKER";
    const response = chunkedResponse(Array(9).fill(marker.repeat(4_000)));

    try {
      await readCatalogText(response);
      expect.unreachable("expected CatalogResponseError");
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogResponseError);
      expect((error as CatalogResponseError).code).toBe("catalog_too_large");
      expect((error as Error).message).not.toContain(marker);
      expect(JSON.stringify(error)).not.toContain(marker);
    }
  });
});

describe("parseProviderCatalog", () => {
  it("accepts a valid catalog and strips unknown provider fields", () => {
    const parsed = parseProviderCatalog(
      JSON.stringify({
        providers: [{ id: "search.basic", priceUsd: 0.01, enabled: true, name: "Basic" }]
      })
    );
    expect(parsed.providers[0]).toEqual({ id: "search.basic", priceUsd: 0.01, enabled: true });
  });

  it.each([
    ["malformed JSON", "{"],
    ["missing providers", JSON.stringify({})],
    ["non-finite price", '{"providers":[{"id":"p","priceUsd":1e400}]}'],
    ["zero price", JSON.stringify({ providers: [{ id: "p", priceUsd: 0 }] })],
    ["negative price", JSON.stringify({ providers: [{ id: "p", priceUsd: -0.01 }] })],
    ["unsafe price", JSON.stringify({ providers: [{ id: "p", priceUsd: 1e9 }] })],
    ["missing price", JSON.stringify({ providers: [{ id: "p" }] })],
    ["missing id", JSON.stringify({ providers: [{ priceUsd: 0.01 }] })],
    ["empty id", JSON.stringify({ providers: [{ id: "", priceUsd: 0.01 }] })],
    [
      "duplicate ids",
      JSON.stringify({
        providers: [
          { id: "p", priceUsd: 0.01 },
          { id: "p", priceUsd: 0.02 }
        ]
      })
    ]
  ])("rejects %s", (_label, body) => {
    expect(() => parseProviderCatalog(body)).toThrow(
      expect.objectContaining({ name: "CatalogResponseError", code: "catalog_invalid" })
    );
  });
});

describe("runPaidQuery catalog validation", () => {
  afterEach(() => {
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_CLIENT_SECRET_KEY;
    delete process.env.API_BASE_URL;
    delete process.env.STELLAR_NETWORK;
    delete process.env.X402_ASSET;
    vi.resetModules();
  });

  it("never signs when the catalog response is malformed", async () => {
    process.env.DEMO_MODE = "false";
    process.env.DEMO_CLIENT_SECRET_KEY = "S".padEnd(56, "A");
    process.env.API_BASE_URL = "http://localhost:3001";
    process.env.STELLAR_NETWORK = "stellar:testnet";
    process.env.X402_ASSET = USDC_TESTNET_ADDRESS;
    vi.resetModules();

    const sign = vi.fn();
    const requested: string[] = [];
    const fetchStub = vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      requested.push(href);
      if (href.includes("/api/providers")) {
        return new Response('{"providers":[{"id":"search.basic","priceUsd":1e400}]}', {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("{}", { status: 402 });
    });

    const { runPaidQuery } = await import("./client.js");
    await expect(
      runPaidQuery(
        { mode: "search", provider: "search.basic", query: "stellar" },
        {
          fetch: fetchStub as unknown as typeof fetch,
          createPaymentHeaders: async () => {
            sign();
            return { "PAYMENT-SIGNATURE": "should-not-sign" };
          }
        }
      )
    ).rejects.toMatchObject({ name: "CatalogResponseError", code: "catalog_invalid" });

    expect(sign).not.toHaveBeenCalled();
    expect(requested.some((href) => href.includes("/x402/"))).toBe(false);
  });
});
