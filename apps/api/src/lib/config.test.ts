import { describe, expect, it } from "vitest";
import {
  parseAndValidateCorsOrigins,
  validateCorsOrigin
} from "./config.js";

describe("CORS origin validation (table-driven)", () => {
  describe("valid canonical HTTP(S) origins", () => {
    it.each([
      ["http://localhost:3000", "http://localhost:3000"],
      ["http://127.0.0.1:5173", "http://127.0.0.1:5173"],
      ["http://example.com", "http://example.com"],
      ["https://example.com", "https://example.com"],
      ["https://app.example.com", "https://app.example.com"],
      ["https://app.example.com:8443", "https://app.example.com:8443"],
      ["HTTPS://EXAMPLE.COM:3001", "https://example.com:3001"],
      ["https://sub.domain.example.org", "https://sub.domain.example.org"]
    ])("accepts canonical origin %s -> %s", (input, expected) => {
      expect(validateCorsOrigin(input)).toBe(expected);
    });
  });

  describe("rejected invalid origins", () => {
    it.each([
      // Credentials
      ["https://user:password@example.com", "credentials are not allowed"],
      ["http://admin:secret@localhost:3000", "credentials are not allowed"],
      ["https://token@example.com", "credentials are not allowed"],
      // Paths and trailing slashes
      ["https://example.com/", "paths and trailing slashes are not allowed"],
      ["https://example.com/path", "paths and trailing slashes are not allowed"],
      ["http://localhost:3000/api/v1", "paths and trailing slashes are not allowed"],
      // Queries
      ["https://example.com?query=true", "queries are not allowed"],
      ["https://example.com:3000/?a=b", "queries are not allowed"],
      // Fragments
      ["https://example.com#section", "fragments are not allowed"],
      // Wildcards
      ["*", "wildcard or null origins are not allowed"],
      ["https://*", "wildcard or null origins are not allowed"],
      ["https://*.example.com", "wildcard or null origins are not allowed"],
      // Null
      ["null", "wildcard or null origins are not allowed"],
      ["NULL", "wildcard or null origins are not allowed"],
      // Non-HTTP(S) schemes
      ["ftp://example.com", "scheme must be http or https"],
      ["ws://example.com", "scheme must be http or https"],
      ["javascript:alert(1)", "scheme must be http or https"],
      // Empty or invalid
      ["", "empty origin is not allowed"],
      ["   ", "empty origin is not allowed"],
      ["not-a-valid-url", "must be a valid HTTP or HTTPS origin"]
    ])("rejects %s with error containing %s", (input, expectedSubstr) => {
      expect(() => validateCorsOrigin(input)).toThrow(expectedSubstr);
    });

    it("never echoes embedded credentials in error message", () => {
      const secretPass = "super_secret_password_12345";
      const input = `https://user:${secretPass}@example.com`;
      try {
        validateCorsOrigin(input);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as Error).message).not.toContain(secretPass);
        expect((err as Error).message).not.toContain("user");
      }
    });
  });

  describe("parseAndValidateCorsOrigins", () => {
    it("parses comma-separated canonical origins", () => {
      const raw = "https://app.example.com, http://localhost:3000, https://api.example.com:8443";
      expect(parseAndValidateCorsOrigins(raw)).toEqual([
        "https://app.example.com",
        "http://localhost:3000",
        "https://api.example.com:8443"
      ]);
    });

    it("returns empty array for empty, undefined, or whitespace", () => {
      expect(parseAndValidateCorsOrigins(undefined)).toEqual([]);
      expect(parseAndValidateCorsOrigins("")).toEqual([]);
      expect(parseAndValidateCorsOrigins("   ")).toEqual([]);
    });

    it("fails closed on any invalid origin in the list", () => {
      const raw = "https://example.com, null, https://app.example.com";
      expect(() => parseAndValidateCorsOrigins(raw)).toThrow(
        "wildcard or null origins are not allowed"
      );
    });
  });
});
