import { describe, expect, it } from "vitest";
import {
  MIN_PRODUCTION_API_KEY_BYTES,
  MIN_PRODUCTION_SIGNING_SECRET_BYTES,
  parseAndValidateCorsOrigins,
  validateCorsOrigin,
  validateProductionSecret,
  validateProductionSecrets
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

describe("Production secret strength validation", () => {
  const STRONG_SIGNING_SECRET = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  const STRONG_API_KEY = "fac_key_prod_9f86d081884c7d659a2f";

  describe("production environment enforcement", () => {
    it("rejects secrets shorter than minimum byte length", () => {
      expect(() =>
        validateProductionSecret(
          "SPONSORSHIP_SIGNING_SECRET",
          "too-short",
          MIN_PRODUCTION_SIGNING_SECRET_BYTES
        )
      ).toThrow("must be at least 32 bytes");

      expect(() =>
        validateProductionSecret(
          "X402_FACILITATOR_API_KEY",
          "short",
          MIN_PRODUCTION_API_KEY_BYTES
        )
      ).toThrow("must be at least 16 bytes");
    });

    it.each([
      "placeholder-signing-secret-value-longer-than-32-chars",
      "change_me_to_a_real_production_secret_key_please",
      "replace-me-with-production-signing-secret-now",
      "your_secret_here_replace_before_deploying_to_prod",
      "example-secret-key-that-is-long-enough-for-length-check",
      "test-secret-key-for-testing-purposes-only-12345678",
      "dev-signing-key-for-local-development-only-12345678",
      "1234567890123456789012345678901234567890",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "default_signing_secret_for_the_service_instance"
    ])("rejects known placeholder-shaped secret: %s", (placeholder) => {
      expect(() =>
        validateProductionSecret(
          "SPONSORSHIP_SIGNING_SECRET",
          placeholder,
          MIN_PRODUCTION_SIGNING_SECRET_BYTES
        )
      ).toThrow("placeholder value rejected");
    });

    it("accepts strong production secrets", () => {
      expect(() =>
        validateProductionSecret(
          "SPONSORSHIP_SIGNING_SECRET",
          STRONG_SIGNING_SECRET,
          MIN_PRODUCTION_SIGNING_SECRET_BYTES
        )
      ).not.toThrow();

      expect(() =>
        validateProductionSecret(
          "X402_FACILITATOR_API_KEY",
          STRONG_API_KEY,
          MIN_PRODUCTION_API_KEY_BYTES
        )
      ).not.toThrow();
    });

    it("errors name only the variable, never its value", () => {
      const dangerousSecret = "change_me_super_secret_payload_value";
      try {
        validateProductionSecret(
          "SPONSORSHIP_SIGNING_SECRET",
          dangerousSecret,
          MIN_PRODUCTION_SIGNING_SECRET_BYTES
        );
        expect.unreachable("should have thrown");
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toContain("SPONSORSHIP_SIGNING_SECRET");
        expect(msg).not.toContain(dangerousSecret);
        expect(msg).not.toContain("super_secret_payload_value");
      }
    });

    it("validateProductionSecrets enforces all configured secrets in production", () => {
      expect(() =>
        validateProductionSecrets({
          NODE_ENV: "production",
          SPONSORSHIP_SIGNING_SECRET: "short",
          X402_FACILITATOR_API_KEY: STRONG_API_KEY
        })
      ).toThrow("SPONSORSHIP_SIGNING_SECRET");

      expect(() =>
        validateProductionSecrets({
          NODE_ENV: "production",
          SPONSORSHIP_SIGNING_SECRET: STRONG_SIGNING_SECRET,
          X402_FACILITATOR_API_KEY: "change_me_api_key_long_enough"
        })
      ).toThrow("X402_FACILITATOR_API_KEY");

      expect(() =>
        validateProductionSecrets({
          NODE_ENV: "production",
          SPONSORSHIP_SIGNING_SECRET: STRONG_SIGNING_SECRET,
          X402_FACILITATOR_API_KEY: STRONG_API_KEY
        })
      ).not.toThrow();
    });
  });

  describe("development and test fixtures remain supported", () => {
    it("permits short or placeholder secrets when NODE_ENV is development", () => {
      expect(() =>
        validateProductionSecrets({
          NODE_ENV: "development",
          SPONSORSHIP_SIGNING_SECRET: "test-secret",
          X402_FACILITATOR_API_KEY: "dev-key"
        })
      ).not.toThrow();
    });

    it("permits short or placeholder secrets when NODE_ENV is test", () => {
      expect(() =>
        validateProductionSecrets({
          NODE_ENV: "test",
          SPONSORSHIP_SIGNING_SECRET: "test-signing-secret",
          X402_FACILITATOR_API_KEY: "test"
        })
      ).not.toThrow();
    });

    it("permits unset or empty secrets even in production", () => {
      expect(() =>
        validateProductionSecrets({
          NODE_ENV: "production",
          SPONSORSHIP_SIGNING_SECRET: undefined,
          X402_FACILITATOR_API_KEY: undefined
        })
      ).not.toThrow();
    });
  });
});
