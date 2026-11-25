import { describe, expect, it } from "vitest";
import { parseCorsOrigins } from "./config.js";

describe("parseCorsOrigins", () => {
  it("trims and deduplicates normalized origins", () => {
    expect(
      parseCorsOrigins(" https://Example.com/ ,https://example.com, http://localhost:3000 ")
    ).toEqual(["https://example.com", "http://localhost:3000"]);
  });

  it("accepts exactly 100 unique origins", () => {
    const origins = Array.from({ length: 100 }, (_, index) => `https://origin-${index}.example`);

    expect(parseCorsOrigins(origins.join(","))).toHaveLength(100);
  });

  it("rejects more than 100 unique origins", () => {
    const origins = Array.from({ length: 101 }, (_, index) => `https://origin-${index}.example`);

    expect(() => parseCorsOrigins(origins.join(","))).toThrow(
      "CORS_ORIGINS exceeds the maximum of 100 unique origins"
    );
  });

  it("accepts exactly 8 KiB of CORS_ORIGINS", () => {
    const origin = "https://example.com";
    const value = `${origin}${" ".repeat(8 * 1024 - origin.length)}`;

    expect(Buffer.byteLength(value, "utf8")).toBe(8 * 1024);
    expect(parseCorsOrigins(value)).toEqual([origin]);
  });

  it("rejects more than 8 KiB of CORS_ORIGINS", () => {
    const value = `${"https://example.com"}${" ".repeat(8 * 1024 - "https://example.com".length + 1)}`;

    expect(() => parseCorsOrigins(value)).toThrow(
      "CORS_ORIGINS exceeds the maximum size of 8192 bytes"
    );
  });
});
