import { describe, it, expect, beforeEach } from "vitest";
import type { UsageEvent, PaymentAttempt, QueryMode } from "@query402/shared";
import { getPublicAnalytics, getDetailedAnalytics } from "../../../src/lib/analytics-service";

// Test helpers
function createMockUsageEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  const baseTime = new Date("2024-01-15T10:00:00Z").toISOString();
  const mode: QueryMode = overrides.mode ?? "search";
  return {
    id: `use_${Math.random().toString(36).slice(2)}`,
    mode,
    endpoint: "/x402/search",
    providerId: "search.basic",
    queryOrUrl: "test query",
    priceUsd: 0.01,
    network: "Test SDF Network ; September 2015",
    paymentStatus: "paid",
    traceId: "trace-123",
    createdAt: baseTime,
    latencyMs: 150,
    ...overrides
  };
}

function createMockPayment(overrides: Partial<PaymentAttempt> = {}): PaymentAttempt {
  const baseTime = new Date("2024-01-15T10:00:00Z").toISOString();
  return {
    id: `pay_${Math.random().toString(36).slice(2)}`,
    endpoint: "/x402/search",
    providerId: "search.basic",
    amountUsd: 0.01,
    network: "Test SDF Network ; September 2015",
    payToAddress: "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ",
    facilitatorUrl: "http://localhost:8080",
    status: "settled",
    createdAt: baseTime,
    ...overrides
  };
}

describe("analytics-service", () => {
  describe("getPublicAnalytics", () => {
    it("should aggregate demo-paid queries separately", () => {
      const usage = [
        createMockUsageEvent({
          id: "use_1",
          paymentStatus: "demo-paid",
          priceUsd: 0.01,
          mode: "search"
        }),
        createMockUsageEvent({
          id: "use_2",
          paymentStatus: "demo-paid",
          priceUsd: 0.02,
          mode: "news"
        })
      ];

      const result = getPublicAnalytics(usage, []);

      expect(result.aggregation.demoPaid.totalCount).toBe(2);
      expect(result.aggregation.demoPaid.totalVolumeUsd).toBe(0.03);
      expect(result.aggregation.demoPaid.byCategory.search.count).toBe(1);
      expect(result.aggregation.demoPaid.byCategory.news.count).toBe(1);
      expect(result.aggregation.settled.totalCount).toBe(0);
    });

    it("should separate settled payments", () => {
      const usage = [
        createMockUsageEvent({
          id: "use_1",
          paymentStatus: "paid",
          priceUsd: 0.01
        })
      ];
      const payments = [
        createMockPayment({ id: "pay_1", status: "settled" })
      ];

      const result = getPublicAnalytics(usage, payments);

      expect(result.aggregation.settled.totalCount).toBe(1);
      expect(result.aggregation.settled.totalVolumeUsd).toBe(0.01);
    });

    it("should separate failed payments", () => {
      const usage = [
        createMockUsageEvent({
          id: "use_1",
          paymentStatus: "failed",
          priceUsd: 0.01
        })
      ];

      const result = getPublicAnalytics(usage, []);

      expect(result.aggregation.failed.totalCount).toBe(1);
      expect(result.aggregation.failed.totalVolumeUsd).toBe(0.01);
    });

    it("should not include raw query text", () => {
      const usage = [
        createMockUsageEvent({
          queryOrUrl: "SELECT * FROM sensitive_data"
        })
      ];

      const result = getPublicAnalytics(usage, []);

      // Check that queryOrUrl is not in the response
      const responseJson = JSON.stringify(result);
      expect(responseJson).not.toContain("SELECT * FROM");
    });

    it("should not expose full payer addresses", () => {
      const usage = [
        createMockUsageEvent({
          payerPublicKey: "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ"
        })
      ];

      const result = getPublicAnalytics(usage, []);

      // Check that full address is not in the response
      const responseJson = JSON.stringify(result);
      expect(responseJson).not.toContain("GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ");
    });

    it("should hash payer keys when within retention", () => {
      const usage = [
        createMockUsageEvent({
          payerPublicKey: "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ",
          createdAt: new Date().toISOString() // Recent, within 90-day default
        })
      ];

      const result = getPublicAnalytics(usage, []);

      expect(result.recentRecords[0].payerHash).toBeDefined();
      expect(result.recentRecords[0].payerHash?.length).toBe(16); // SHA256 truncated
    });

    it("should redact payer hash when outside retention", () => {
      const usage = [
        createMockUsageEvent({
          payerPublicKey: "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ",
          createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString() // 91 days ago
        })
      ];

      const result = getPublicAnalytics(usage, [], {}, { retentionDays: 90, maxPageLimit: 100, defaultPageLimit: 20 });

      expect(result.recentRecords[0].payerHash).toBeUndefined();
    });

    it("should support cursor pagination", () => {
      const usage = Array.from({ length: 25 }, (_, i) =>
        createMockUsageEvent({
          id: `use_${i}`,
          createdAt: new Date(Date.now() - i * 1000).toISOString()
        })
      );

      const firstPage = getPublicAnalytics(usage, [], { limit: 10 });

      expect(firstPage.recentRecords).toHaveLength(10);
      expect(firstPage.pagination.hasMore).toBe(true);
      expect(firstPage.pagination.nextCursor).toBeDefined();

      const secondPage = getPublicAnalytics(usage, [], {
        cursor: firstPage.pagination.nextCursor,
        limit: 10
      });

      expect(secondPage.recentRecords).toHaveLength(10);
      expect(secondPage.recentRecords[0].id).not.toBe(firstPage.recentRecords[0].id);
    });

    it("should enforce max page limit", () => {
      const usage = Array.from({ length: 50 }, (_, i) =>
        createMockUsageEvent({ id: `use_${i}` })
      );

      const result = getPublicAnalytics(usage, [], { limit: 200 }, { maxPageLimit: 30, defaultPageLimit: 20 });

      expect(result.recentRecords).toHaveLength(30);
    });

    it("should aggregate by category correctly", () => {
      const usage = [
        createMockUsageEvent({ mode: "search", priceUsd: 0.01 }),
        createMockUsageEvent({ mode: "search", priceUsd: 0.02 }),
        createMockUsageEvent({ mode: "news", priceUsd: 0.015 }),
        createMockUsageEvent({ mode: "scrape", priceUsd: 0.03 })
      ];

      const result = getPublicAnalytics(usage, []);

      expect(result.aggregation.settled.byCategory.search.count).toBe(2);
      expect(result.aggregation.settled.byCategory.search.volumeUsd).toBe(0.03);
      expect(result.aggregation.settled.byCategory.news.count).toBe(1);
      expect(result.aggregation.settled.byCategory.news.volumeUsd).toBe(0.015);
      expect(result.aggregation.settled.byCategory.scrape.count).toBe(1);
      expect(result.aggregation.settled.byCategory.scrape.volumeUsd).toBe(0.03);
    });

    it("should handle floating point precision", () => {
      const usage = [
        createMockUsageEvent({ priceUsd: 0.1 }),
        createMockUsageEvent({ priceUsd: 0.2 }),
        createMockUsageEvent({ priceUsd: 0.3 })
      ];

      const result = getPublicAnalytics(usage, []);

      expect(result.aggregation.settled.totalVolumeUsd).toBe(0.6);
    });

    it("should return pagination metadata", () => {
      const usage = [
        createMockUsageEvent({ id: "use_1" })
      ];

      const result = getPublicAnalytics(usage, [], { limit: 20 });

      expect(result.pagination.limit).toBe(20);
      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.nextCursor).toBeUndefined();
    });
  });

  describe("getDetailedAnalytics", () => {
    it("should include transaction hashes", () => {
      const usage = [
        createMockUsageEvent({
          paymentTxHash: "tx_123abc"
        })
      ];

      const result = getDetailedAnalytics(usage, []);

      expect(result.records[0].paymentTxHash).toBe("tx_123abc");
    });

    it("should redact transaction hashes outside retention", () => {
      const usage = [
        createMockUsageEvent({
          paymentTxHash: "tx_123abc",
          createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString()
        })
      ];

      const result = getDetailedAnalytics(usage, [], {}, { retentionDays: 90, maxPageLimit: 100, defaultPageLimit: 20 });

      expect(result.records[0].paymentTxHash).toBeUndefined();
    });

    it("should never expose full payer keys", () => {
      const usage = [
        createMockUsageEvent({
          payerPublicKey: "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ"
        })
      ];

      const result = getDetailedAnalytics(usage, []);

      // Should have a hash, not the full key
      expect(result.records[0].payerKeyHash).toBeDefined();
      expect(result.records[0].payerKeyHash).not.toContain("GBLL3LQVV3");
    });

    it("should include aggregation data", () => {
      const usage = [
        createMockUsageEvent({ paymentStatus: "demo-paid", priceUsd: 0.01 }),
        createMockUsageEvent({ paymentStatus: "paid", priceUsd: 0.02 })
      ];

      const result = getDetailedAnalytics(usage, []);

      expect(result.aggregation.demoPaid.totalCount).toBe(1);
      expect(result.aggregation.settled.totalCount).toBe(1);
    });

    it("should support cursor pagination", () => {
      const usage = Array.from({ length: 25 }, (_, i) =>
        createMockUsageEvent({
          id: `use_${i}`,
          createdAt: new Date(Date.now() - i * 1000).toISOString()
        })
      );

      const firstPage = getDetailedAnalytics(usage, [], { limit: 10 });

      expect(firstPage.records).toHaveLength(10);
      expect(firstPage.pagination.hasMore).toBe(true);

      const secondPage = getDetailedAnalytics(usage, [], {
        cursor: firstPage.pagination.nextCursor,
        limit: 10
      });

      expect(secondPage.records).toHaveLength(10);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty usage", () => {
      const result = getPublicAnalytics([], []);

      expect(result.aggregation.demoPaid.totalCount).toBe(0);
      expect(result.aggregation.settled.totalCount).toBe(0);
      expect(result.aggregation.verified.totalCount).toBe(0);
      expect(result.aggregation.failed.totalCount).toBe(0);
      expect(result.recentRecords).toHaveLength(0);
      expect(result.pagination.hasMore).toBe(false);
    });

    it("should handle mixed settlement statuses", () => {
      const usage = [
        createMockUsageEvent({ id: "use_1", paymentStatus: "demo-paid", priceUsd: 0.01 }),
        createMockUsageEvent({ id: "use_2", paymentStatus: "paid", priceUsd: 0.02 }),
        createMockUsageEvent({ id: "use_3", paymentStatus: "failed", priceUsd: 0.015 })
      ];

      const result = getPublicAnalytics(usage, []);

      expect(result.aggregation.demoPaid.totalCount).toBe(1);
      expect(result.aggregation.settled.totalCount).toBe(1);
      expect(result.aggregation.failed.totalCount).toBe(1);
      expect(result.aggregation.demoPaid.totalVolumeUsd).toBe(0.01);
      expect(result.aggregation.settled.totalVolumeUsd).toBe(0.02);
      expect(result.aggregation.failed.totalVolumeUsd).toBe(0.015);
    });

    it("should handle records with no payer key", () => {
      const usage = [
        createMockUsageEvent({ payerPublicKey: undefined })
      ];

      const result = getPublicAnalytics(usage, []);

      expect(result.recentRecords[0].payerHash).toBeUndefined();
    });

    it("should handle invalid cursor gracefully", () => {
      const usage = [
        createMockUsageEvent({ id: "use_1" })
      ];

      const result = getPublicAnalytics(usage, [], { cursor: "invalid-cursor" });

      // Should treat as no cursor
      expect(result.recentRecords).toHaveLength(1);
    });

    it("should handle zero-priced queries", () => {
      const usage = [
        createMockUsageEvent({ priceUsd: 0 }),
        createMockUsageEvent({ priceUsd: 0.01 })
      ];

      const result = getPublicAnalytics(usage, []);

      expect(result.aggregation.settled.totalCount).toBe(2);
      expect(result.aggregation.settled.totalVolumeUsd).toBe(0.01);
    });

    it("should maintain correct order (newest first)", () => {
      const now = Date.now();
      const usage = [
        createMockUsageEvent({
          id: "use_1",
          createdAt: new Date(now - 1000).toISOString()
        }),
        createMockUsageEvent({
          id: "use_2",
          createdAt: new Date(now - 2000).toISOString()
        }),
        createMockUsageEvent({
          id: "use_3",
          createdAt: new Date(now - 3000).toISOString()
        })
      ];

      const result = getPublicAnalytics(usage, [], { limit: 3 });

      expect(result.recentRecords[0].id).toBe("use_1");
      expect(result.recentRecords[1].id).toBe("use_2");
      expect(result.recentRecords[2].id).toBe("use_3");
    });
  });

  describe("Security and Privacy", () => {
    it("should not expose sensitive payment payloads", () => {
      const usage = [
        createMockUsageEvent({
          paymentTxHash: "secret_payload_data"
        })
      ];

      const result = getPublicAnalytics(usage, []);

      // Public endpoint should not have txHash
      expect(result.recentRecords[0].paymentTxHash).toBeUndefined();
    });

    it("should never include queryOrUrl in public response", () => {
      const usage = [
        createMockUsageEvent({
          queryOrUrl: "https://sensitive-url.com/private?key=secret123"
        })
      ];

      const result = getPublicAnalytics(usage, []);
      const json = JSON.stringify(result);

      expect(json).not.toContain("https://sensitive-url.com");
      expect(json).not.toContain("secret123");
    });

    it("should never include facilitatorUrl from usage in response", () => {
      const usage = [
        createMockUsageEvent({
          facilitatorUrl: "http://internal-facilitator:8080"
        })
      ];

      const result = getPublicAnalytics(usage, []);
      const json = JSON.stringify(result);

      expect(json).not.toContain("internal-facilitator");
    });

    it("should validate limit prevents excessive data exposure", () => {
      const usage = Array.from({ length: 1000 }, (_, i) =>
        createMockUsageEvent({ id: `use_${i}` })
      );

      const result = getPublicAnalytics(usage, [], { limit: 10000 }, { maxPageLimit: 100, defaultPageLimit: 20 });

      expect(result.recentRecords).toHaveLength(100);
    });
  });
});
