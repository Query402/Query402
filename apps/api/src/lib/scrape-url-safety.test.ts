import assert from "node:assert/strict";
import test from "node:test";
import { safeScrapeFetch, UnsafeScrapeUrlError, validateScrapeUrl } from "./scrape-url-safety.js";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 as const }];

async function rejectsUnsafe(input: string) {
  await assert.rejects(() => validateScrapeUrl(input, { resolveHostname: publicResolver }), UnsafeScrapeUrlError);
}

test("allows http and https URLs that resolve to public addresses", async () => {
  await assert.doesNotReject(() => validateScrapeUrl("https://example.com/page?q=1", { resolveHostname: publicResolver }));
  await assert.doesNotReject(() => validateScrapeUrl("http://example.com", { resolveHostname: publicResolver }));
});

test("rejects unsupported protocols, credentials, and local hostnames", async () => {
  await rejectsUnsafe("file:///etc/passwd");
  await rejectsUnsafe("ftp://example.com");
  await rejectsUnsafe("https://user:pass@example.com");
  await rejectsUnsafe("https://localhost");
  await rejectsUnsafe("https://localhost.");
  await rejectsUnsafe("https://app.localhost");
  await rejectsUnsafe("https://app.localhost.");
  await rejectsUnsafe("https://service.local");
  await rejectsUnsafe("https://service.local.");
  await rejectsUnsafe("https://service.internal");
  await rejectsUnsafe("https://service.internal.");
});

test("rejects IPv4 private, loopback, link-local, reserved, multicast, and metadata ranges", async () => {
  const blocked = [
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
  ];

  for (const url of blocked) {
    await assert.rejects(() => validateScrapeUrl(url), UnsafeScrapeUrlError, url);
  }
});

test("rejects encoded and alternate IPv4 bypass forms after URL canonicalization", async () => {
  const blocked = [
    "http://2130706433",
    "http://0177.0.0.1",
    "http://0x7f.0.0.1",
    "http://127.1",
    "http://%31%32%37.0.0.1"
  ];

  for (const url of blocked) {
    await assert.rejects(() => validateScrapeUrl(url), UnsafeScrapeUrlError, url);
  }
});

test("rejects IPv6 local, private, reserved, multicast, and IPv4-mapped ranges", async () => {
  const blocked = [
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
  ];

  for (const url of blocked) {
    await assert.rejects(() => validateScrapeUrl(url), UnsafeScrapeUrlError, url);
  }
});

test("rejects DNS answers that contain any unsafe address", async () => {
  await assert.rejects(
    () =>
      validateScrapeUrl("https://example.com", {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 }
        ]
      }),
    UnsafeScrapeUrlError
  );
});

test("safeScrapeFetch revalidates redirect targets and enforces redirect limit", async () => {
  const redirectingFetch: typeof fetch = async () =>
    new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data" }
    });

  await assert.rejects(
    () =>
      safeScrapeFetch("https://example.com", {
        fetchImpl: redirectingFetch,
        resolveHostname: publicResolver
      }),
    UnsafeScrapeUrlError
  );

  const loopingFetch: typeof fetch = async () =>
    new Response(null, {
      status: 302,
      headers: { location: "https://example.com/next" }
    });

  await assert.rejects(
    () =>
      safeScrapeFetch("https://example.com", {
        fetchImpl: loopingFetch,
        resolveHostname: publicResolver,
        maxRedirects: 1
      }),
    UnsafeScrapeUrlError
  );
});

test("safeScrapeFetch enforces accepted content types and response size", async () => {
  await assert.rejects(
    () =>
      safeScrapeFetch("https://example.com", {
        fetchImpl: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
        resolveHostname: publicResolver
      }),
    UnsafeScrapeUrlError
  );

  await assert.rejects(
    () =>
      safeScrapeFetch("https://example.com", {
        fetchImpl: async () => new Response("too large", { headers: { "content-type": "text/html" } }),
        resolveHostname: publicResolver,
        maxResponseBytes: 3
      }),
    UnsafeScrapeUrlError
  );
});

test("safeScrapeFetch returns text content from a safe response", async () => {
  const result = await safeScrapeFetch("https://example.com", {
    fetchImpl: async () => new Response("<html>ok</html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
    resolveHostname: publicResolver
  });

  assert.equal(result.url, "https://example.com/");
  assert.equal(result.body, "<html>ok</html>");
});
