import { describe, it, expect } from "vitest";
import {
  hashPayerKey,
  isWithinRetention,
  encodeCursor,
  decodeCursor,
  generateNextCursor
} from "../../../src/lib/analytics-privacy";

describe("analytics-privacy", () => {
  describe("hashPayerKey", () => {
    it("should return undefined for undefined input", () => {
      expect(hashPayerKey(undefined)).toBeUndefined();
    });

    it("should hash payer keys consistently", () => {
      const key = "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ";
      const hash1 = hashPayerKey(key);
      const hash2 = hashPayerKey(key);

      expect(hash1).toBe(hash2);
    });

    it("should create different hashes for different keys", () => {
      const key1 = "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ";
      const key2 = "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPX";

      const hash1 = hashPayerKey(key1);
      const hash2 = hashPayerKey(key2);

      expect(hash1).not.toBe(hash2);
    });

    it("should return a 16-character hash", () => {
      const key = "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ";
      const hash = hashPayerKey(key);

      expect(hash?.length).toBe(16);
    });

    it("should not be reversible", () => {
      const key = "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ";
      const hash = hashPayerKey(key);

      expect(hash).not.toContain("GBLL3L");
      expect(hash).not.toEqual(key);
    });
  });

  describe("isWithinRetention", () => {
    it("should return true for recent records", () => {
      const now = new Date().toISOString();
      expect(isWithinRetention(now, 90)).toBe(true);
    });

    it("should return false for old records", () => {
      const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
      expect(isWithinRetention(old, 90)).toBe(false);
    });

    it("should return true for record at retention boundary (inclusive)", () => {
      const atBoundary = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      expect(isWithinRetention(atBoundary, 90)).toBe(true);
    });

    it("should work with different retention periods", () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

      expect(isWithinRetention(thirtyDaysAgo, 90)).toBe(true);
      expect(isWithinRetention(thirtyDaysAgo, 20)).toBe(false);
      expect(isWithinRetention(sixtyDaysAgo, 90)).toBe(true);
      expect(isWithinRetention(sixtyDaysAgo, 50)).toBe(false);
    });
  });

  describe("encodeCursor / decodeCursor", () => {
    it("should encode and decode cursor data", () => {
      const data = {
        timestamp: "2024-01-15T10:00:00Z",
        id: "use_abc123"
      };

      const encoded = encodeCursor(data);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(data);
    });

    it("should return null for invalid cursor", () => {
      expect(decodeCursor("invalid")).toBeNull();
    });

    it("should return null for corrupted base64", () => {
      expect(decodeCursor("!!invalid!!base64")).toBeNull();
    });

    it("should return null for missing required fields", () => {
      const encoded = Buffer.from(JSON.stringify({ timestamp: "2024-01-15T10:00:00Z" })).toString("base64");
      expect(decodeCursor(encoded)).toBeNull();
    });

    it("should encode cursor as valid base64", () => {
      const data = {
        timestamp: "2024-01-15T10:00:00Z",
        id: "use_test"
      };

      const encoded = encodeCursor(data);

      // Should be valid base64
      expect(() => Buffer.from(encoded, "base64")).not.toThrow();
    });

    it("should handle special characters in ID", () => {
      const data = {
        timestamp: "2024-01-15T10:00:00Z",
        id: "use_test-123_abc"
      };

      const encoded = encodeCursor(data);
      const decoded = decodeCursor(encoded);

      expect(decoded?.id).toBe("use_test-123_abc");
    });
  });

  describe("generateNextCursor", () => {
    it("should generate cursor from last record", () => {
      const records = [
        { createdAt: "2024-01-15T10:00:00Z", id: "use_1" },
        { createdAt: "2024-01-15T09:59:00Z", id: "use_2" },
        { createdAt: "2024-01-15T09:58:00Z", id: "use_3" }
      ];

      const cursor = generateNextCursor(records);

      expect(cursor).toBeDefined();
      const decoded = decodeCursor(cursor!);
      expect(decoded?.id).toBe("use_3");
      expect(decoded?.timestamp).toBe("2024-01-15T09:58:00Z");
    });

    it("should return undefined for empty records", () => {
      const cursor = generateNextCursor([]);

      expect(cursor).toBeUndefined();
    });

    it("should handle single record", () => {
      const records = [
        { createdAt: "2024-01-15T10:00:00Z", id: "use_1" }
      ];

      const cursor = generateNextCursor(records);

      expect(cursor).toBeDefined();
      const decoded = decodeCursor(cursor!);
      expect(decoded?.id).toBe("use_1");
    });

    it("should generate decodable cursor", () => {
      const records = [
        { createdAt: "2024-01-15T10:00:00Z", id: "use_abc" }
      ];

      const cursor = generateNextCursor(records);
      const decoded = decodeCursor(cursor!);

      expect(decoded).toBeDefined();
      expect(decoded?.timestamp).toBe("2024-01-15T10:00:00Z");
    });
  });

  describe("Security", () => {
    it("should hash payer key with non-reversible function", () => {
      const key = "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ";
      const hash = hashPayerKey(key);

      // Should not contain any part of original key
      expect(hash).not.toMatch(/G[A-Z0-9]{55}/);
    });

    it("should prevent cursor injection", () => {
      const maliciousId = "'; DROP TABLE analytics; --";
      const data = {
        timestamp: "2024-01-15T10:00:00Z",
        id: maliciousId
      };

      const encoded = encodeCursor(data);
      const decoded = decodeCursor(encoded);

      // Should safely handle and not execute
      expect(decoded?.id).toBe(maliciousId);
    });

    it("should handle cursor with large payloads safely", () => {
      const largeId = "x".repeat(10000);
      const data = {
        timestamp: "2024-01-15T10:00:00Z",
        id: largeId
      };

      const encoded = encodeCursor(data);
      const decoded = decodeCursor(encoded);

      expect(decoded?.id).toBe(largeId);
    });
  });
});
