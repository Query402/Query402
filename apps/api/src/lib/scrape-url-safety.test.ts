import { describe, expect, it } from "vitest";
import { safeScrapeFetch, UnsafeScrapeUrlError, validateScrapeUrl } from "./scrape-url-safety.js";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 as const }];

async function rejectsUnsafe(input: string) {
  await expect(
    validateScrapeUrl(input, { resolveHostname: publicResolver })
  ).rejects.toBeInstanceOf(UnsafeScrapeUrlError);
}

describe("scrape URL safety", () => {
  it("allows http and https URLs that resolve to public addresses", async () => {
    await expect(
      validateScrapeUrl("https://example.com/page?q=1", { resolveHostname: publicResolver })
    ).resolves.toBe("https://example.com/page?q=1");
    await expect(
      validateScrapeUrl("http://example.com", { resolveHostname: publicResolver })
    ).resolves.toBe("http://example.com/");
  });

  it("rejects unsupported protocols, credentials, and local hostnames", async () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com",
      "https://user:pass@example.com",
      "https://localhost",
      "https://localhost.",
      "https://app.localhost",
      "https://app.localhost.",
      "https://service.local",
      "https://service.local.",
      "https://service.internal"
    ]) {
      await rejectsUnsafe(url);
    }
  });

  it("rejects IPv4 private, loopback, link-local, reserved, multicast, and metadata ranges", async () => {
    for (const url of [
      "http://0.0.0.0",
      "http://10.0.0.5",
      "http://100.64.0.1",
      "http://127.0.0.1",
      "http://169.254.169.254",
      "http://172.16.1.1",
      "http://192.88.99.1",
      "http://192.0.2.1",
      "http://192.168.1.1",
      "http://198.18.0.1",
      "http://203.0.113.10",
      "http://224.0.0.1",
      "http://240.0.0.1"
    ]) {
      await expect(validateScrapeUrl(url)).rejects.toBeInstanceOf(UnsafeScrapeUrlError);
    }
  });

  it("rejects encoded and alternate IPv4 bypass forms after URL canonicalization", async () => {
    for (const url of [
      "http://2130706433",
      "http://0177.0.0.1",
      "http://0x7f.0.0.1",
      "http://127.1",
      "http://%31%32%37.0.0.1"
    ]) {
      await expect(validateScrapeUrl(url)).rejects.toBeInstanceOf(UnsafeScrapeUrlError);
    }
  });

  it("rejects IPv6 local, private, reserved, multicast, and IPv4-mapped ranges", async () => {
    for (const url of [
      "http://[::]",
      "http://[::1]",
      "http://[::ffff:127.0.0.1]",
      "http://[64:ff9b::1]",
      "http://[fc00::1]",
      "http://[fd12:3456::1]",
      "http://[fe80::1]",
      "http://[ff02::1]",
      "http://[2001:db8::1]",
      "http://[2002::1]",
      "http://[3fff::1]"
    ]) {
      await expect(validateScrapeUrl(url)).rejects.toBeInstanceOf(UnsafeScrapeUrlError);
    }
  });

  it("rejects DNS answers that contain any unsafe address", async () => {
    await expect(
      validateScrapeUrl("https://example.com", {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 }
        ]
      })
    ).rejects.toBeInstanceOf(UnsafeScrapeUrlError);
  });

  it("safeScrapeFetch revalidates redirect targets and enforces redirect limit", async () => {
    await expect(
      safeScrapeFetch("https://example.com", {
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data" }
          }),
        resolveHostname: publicResolver,
        maxRedirects: 5
      })
    ).rejects.toBeInstanceOf(UnsafeScrapeUrlError);

    await expect(
      safeScrapeFetch("https://example.com", {
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://example.com/next" }
          }),
        resolveHostname: publicResolver,
        maxRedirects: 1
      })
    ).rejects.toBeInstanceOf(UnsafeScrapeUrlError);
  });

  it("safeScrapeFetch enforces accepted content types and response size", async () => {
    await expect(
      safeScrapeFetch("https://example.com", {
        fetchImpl: async () =>
          new Response("{}", { headers: { "content-type": "application/json" } }),
        resolveHostname: publicResolver
      })
    ).rejects.toBeInstanceOf(UnsafeScrapeUrlError);

    await expect(
      safeScrapeFetch("https://example.com", {
        fetchImpl: async () =>
          new Response("too large", { headers: { "content-type": "text/html" } }),
        resolveHostname: publicResolver,
        maxResponseBytes: 3
      })
    ).rejects.toBeInstanceOf(UnsafeScrapeUrlError);
  });

  it("safeScrapeFetch returns text content from a safe response", async () => {
    const result = await safeScrapeFetch("https://example.com", {
      fetchImpl: async () =>
        new Response("<html>ok</html>", {
          headers: { "content-type": "text/html; charset=utf-8" }
        }),
      resolveHostname: publicResolver
    });

    expect(result.url).toBe("https://example.com/");
    expect(result.body).toBe("<html>ok</html>");
  });
});
