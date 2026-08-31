import { describe, expect, it } from "vitest";
import {
  buildPaidRequestFingerprint,
  hashPaidRequestFingerprint,
  normalizeQueryUrl,
  type PaidRequestFingerprintInput
} from "./idempotency.js";

function scrapeInput(url: string, overrides: Partial<PaidRequestFingerprintInput> = {}): PaidRequestFingerprintInput {
  return {
    method: "POST",
    route: "/v1/scrape",
    mode: "scrape",
    provider: "scrape.basic",
    url,
    payer: "0xabc",
    network: "base-sepolia",
    quotedAmountUsd: 0.01,
    ...overrides
  };
}

function hashFor(input: PaidRequestFingerprintInput): string {
  return hashPaidRequestFingerprint(buildPaidRequestFingerprint(input));
}

describe("normalizeQueryUrl", () => {
  describe("casing", () => {
    it("lowercases the scheme and host", () => {
      expect(normalizeQueryUrl("HTTPS://Example.COM/path")).toBe("https://example.com/path");
    });

    it("preserves path casing", () => {
      expect(normalizeQueryUrl("https://example.com/Some/Path")).toBe(
        "https://example.com/Some/Path"
      );
    });
  });

  describe("trailing separators", () => {
    it("strips a single trailing slash", () => {
      expect(normalizeQueryUrl("https://example.com/path/")).toBe("https://example.com/path");
    });

    it("collapses a run of trailing slashes", () => {
      expect(normalizeQueryUrl("https://example.com/path///")).toBe("https://example.com/path");
    });

    it("does not strip the root path down to empty", () => {
      expect(normalizeQueryUrl("https://example.com/")).toBe("https://example.com/");
    });

    it("treats a bare origin (no path) the same as the root path", () => {
      expect(normalizeQueryUrl("https://example.com")).toBe(
        normalizeQueryUrl("https://example.com/")
      );
    });

    it("does not touch an interior slash, only a trailing one", () => {
      expect(normalizeQueryUrl("https://example.com/a/b/c/")).toBe(
        "https://example.com/a/b/c"
      );
    });
  });

  describe("query semantics are preserved", () => {
    it("does not alter query parameter casing", () => {
      const url = "https://example.com/path?Foo=Bar&BAZ=qux";
      expect(normalizeQueryUrl(url)).toBe(url);
    });

    it("does not reorder query parameters", () => {
      const url = "https://example.com/path?z=1&a=2";
      expect(normalizeQueryUrl(url)).toBe(url);
    });

    it("keeps a trailing slash normalization independent of the query string", () => {
      expect(normalizeQueryUrl("https://example.com/path/?x=1")).toBe(
        "https://example.com/path?x=1"
      );
    });

    it("preserves an empty query string marker", () => {
      expect(normalizeQueryUrl("https://example.com/path?")).toBe(
        "https://example.com/path?"
      );
    });
  });

  describe("non-normalizable input", () => {
    it("trims but does not throw on a non-URL string", () => {
      expect(normalizeQueryUrl("  not a url  ")).toBe("not a url");
    });

    it("trims surrounding whitespace on an otherwise valid URL", () => {
      expect(normalizeQueryUrl("  https://example.com/path  ")).toBe(
        "https://example.com/path"
      );
    });
  });
});

describe("buildPaidRequestFingerprint / hashPaidRequestFingerprint — equivalent and distinct URLs", () => {
  describe("equivalent URLs hash identically", () => {
    it("scheme and host casing differences", () => {
      const a = hashFor(scrapeInput("https://example.com/reports"));
      const b = hashFor(scrapeInput("HTTPS://EXAMPLE.COM/reports"));
      expect(a).toBe(b);
    });

    it("a trailing slash difference", () => {
      const a = hashFor(scrapeInput("https://example.com/reports"));
      const b = hashFor(scrapeInput("https://example.com/reports/"));
      expect(a).toBe(b);
    });

    it("multiple trailing slashes vs. none", () => {
      const a = hashFor(scrapeInput("https://example.com/reports"));
      const b = hashFor(scrapeInput("https://example.com/reports///"));
      expect(a).toBe(b);
    });

    it("combined casing and trailing-slash differences, plus incidental whitespace", () => {
      const a = hashFor(scrapeInput("https://example.com/reports"));
      const b = hashFor(scrapeInput("  Https://Example.COM/reports/  "));
      expect(a).toBe(b);
    });

    it("bare origin vs. explicit root path", () => {
      const a = hashFor(scrapeInput("https://example.com"));
      const b = hashFor(scrapeInput("https://example.com/"));
      expect(a).toBe(b);
    });
  });

  describe("distinct URLs hash differently", () => {
    it("different paths", () => {
      const a = hashFor(scrapeInput("https://example.com/reports"));
      const b = hashFor(scrapeInput("https://example.com/invoices"));
      expect(a).not.toBe(b);
    });

    it("different path casing (paths are case-sensitive)", () => {
      const a = hashFor(scrapeInput("https://example.com/Reports"));
      const b = hashFor(scrapeInput("https://example.com/reports"));
      expect(a).not.toBe(b);
    });

    it("different query parameter values", () => {
      const a = hashFor(scrapeInput("https://example.com/reports?id=1"));
      const b = hashFor(scrapeInput("https://example.com/reports?id=2"));
      expect(a).not.toBe(b);
    });

    it("different query parameter casing (query semantics preserved, not normalized)", () => {
      const a = hashFor(scrapeInput("https://example.com/reports?ID=1"));
      const b = hashFor(scrapeInput("https://example.com/reports?id=1"));
      expect(a).not.toBe(b);
    });

    it("different query parameter order (order preserved, not normalized)", () => {
      const a = hashFor(scrapeInput("https://example.com/reports?a=1&b=2"));
      const b = hashFor(scrapeInput("https://example.com/reports?b=2&a=1"));
      expect(a).not.toBe(b);
    });

    it("different hosts", () => {
      const a = hashFor(scrapeInput("https://example.com/reports"));
      const b = hashFor(scrapeInput("https://example.org/reports"));
      expect(a).not.toBe(b);
    });

    it("otherwise-equivalent URLs across different providers", () => {
      const a = hashFor(scrapeInput("https://example.com/reports", { provider: "scrape.basic" }));
      const b = hashFor(scrapeInput("https://example.com/reports", { provider: "scrape.premium" }));
      expect(a).not.toBe(b);
    });
  });

  it("does not affect non-scrape modes, which key off the trimmed query text", () => {
    const a = hashFor({
      method: "GET",
      route: "/v1/search",
      mode: "search",
      provider: "search.basic",
      query: "  best coffee near me  ",
      payer: "0xabc",
      network: "base-sepolia",
      quotedAmountUsd: 0.01
    });
    const b = hashFor({
      method: "GET",
      route: "/v1/search",
      mode: "search",
      provider: "search.basic",
      query: "best coffee near me",
      payer: "0xabc",
      network: "base-sepolia",
      quotedAmountUsd: 0.01
    });
    expect(a).toBe(b);
  });
});
