import { describe, it, expect } from "vitest";
import type { UsageEvent, PaymentAttempt } from "@query402/shared";
import { getPublicAnalytics, getDetailedAnalytics } from "./analytics-service";

/**
 * Integration tests for security and privacy guarantees
 * These tests verify that sensitive data is never exposed in analytics responses
 */

describe("Analytics - Security and Privacy Integration", () => {
  function createMockUsageEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
    const baseTime = new Date("2024-01-15T10:00:00Z").toISOString();
    return {
      id: `use_${Math.random().toString(36).slice(2)}`,
      mode: "search",
      endpoint: "/x402/search",
      providerId: "search.basic",
      queryOrUrl: "SELECT * FROM users WHERE id=1 -- sensitive SQL",
      priceUsd: 0.01,
      network: "Test SDF Network ; September 2015",
      paymentStatus: "paid",
      paymentTxHash: "tx_secret_payload_data_here",
      facilitatorUrl: "http://internal-facilitator:8080/secret",
      payerPublicKey: "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ",
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
      payerPublicKey: "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ",
      payToAddress: "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ",
      facilitatorUrl: "http://internal-facilitator:8080",
      status: "settled",
      transactionHash: "secret_tx_hash_ffffffff",
      createdAt: baseTime,
      ...overrides
    };
  }

  describe("Public Analytics Response - No Sensitive Data", () => {
    it("should not expose raw SQL query", () => {
      const sensitiveQuery = "SELECT password_hash FROM users";
      const usage = [
        createMockUsageEvent({
          queryOrUrl: sensitiveQuery
        })
      ];

      const result = getPublicAnalytics(usage, []);
      const responseJson = JSON.stringify(result);

      expect(responseJson).not.toContain("SELECT password_hash");
      expect(responseJson).not.toContain("users");
    });

    it("should not expose scraped URLs", () => {
      const sensitiveUrl = "https://internal.company.com/private/api?apiKey=sk_123456";
      const usage = [
        createMockUsageEvent({
          queryOrUrl: sensitiveUrl,
          mode: "scrape"
        })
      ];

      const result = getPublicAnalytics(usage, []);
      const responseJson = JSON.stringify(result);

      expect(responseJson).not.toContain("internal.company.com");
      expect(responseJson).not.toContain("sk_123456");
      expect(responseJson).not.toContain("apiKey");
    });

    it("should not expose full payer addresses", () => {
      const payerAddress = "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ";
      const usage = [
        createMockUsageEvent({
          payerPublicKey: payerAddress
        })
      ];

      const result = getPublicAnalytics(usage, []);
      const responseJson = JSON.stringify(result);

      // Full address should not be present
      expect(responseJson).not.toContain("GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ");
    });

    it("should not expose facilitator URLs", () => {
      const facilitatorUrl = "http://internal-facilitator.production.local:8080";
      const usage = [
        createMockUsageEvent({
          facilitatorUrl
        })
      ];

      const result = getPublicAnalytics(usage, []);
      const responseJson = JSON.stringify(result);

      expect(responseJson).not.toContain("internal-facilitator");
      expect(responseJson).not.toContain(".production.local");
    });

    it("should not expose payment transaction hashes in public endpoint", () => {
      const usage = [
        createMockUsageEvent({
          paymentTxHash: "ffffffff_secret_tx_hash_1234567890abcdef"
        })
      ];

      const result = getPublicAnalytics(usage, []);
      const responseJson = JSON.stringify(result);

      expect(responseJson).not.toContain("ffffffff_secret");
    });

    it("should never include queryOrUrl field", () => {
      const usage = [
        createMockUsageEvent({
          queryOrUrl: "https://example.com/secret"
        })
      ];

      const result = getPublicAnalytics(usage, []);

      // Verify structure - recentRecords should not have queryOrUrl
      expect(result.recentRecords[0]).not.toHaveProperty("queryOrUrl");
    });

    it("should never include full facilitatorUrl in usage records", () => {
      const usage = [
        createMockUsageEvent({
          facilitatorUrl: "http://secret-server.internal:8080"
        })
      ];

      const result = getPublicAnalytics(usage, []);

      // Verify structure
      expect(result.recentRecords[0]).not.toHaveProperty("facilitatorUrl");
    });

    it("should never include payerPublicKey (full address) in response", () => {
      const usage = [
        createMockUsageEvent({
          payerPublicKey: "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ"
        })
      ];

      const result = getPublicAnalytics(usage, []);

      // Should have payerHash (hashed), not payerPublicKey
      expect(result.recentRecords[0].payerHash).toBeDefined();
      expect(result.recentRecords[0]).not.toHaveProperty("payerPublicKey");
    });
  });

  describe("Detailed Analytics Response - Minimal Exposure", () => {
    it("should include transaction hashes within retention", () => {
      const usage = [
        createMockUsageEvent({
          paymentTxHash: "tx_abc123def456"
        })
      ];

      const result = getDetailedAnalytics(usage, []);

      expect(result.records[0].paymentTxHash).toBe("tx_abc123def456");
    });

    it("should redact transaction hashes outside retention", () => {
      const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
      const usage = [
        createMockUsageEvent({
          paymentTxHash: "tx_abc123def456",
          createdAt: oldDate
        })
      ];

      const result = getDetailedAnalytics(usage, [], {}, { retentionDays: 90, maxPageLimit: 100, defaultPageLimit: 20 });

      expect(result.records[0].paymentTxHash).toBeUndefined();
    });

    it("should never expose full payer address even in detailed endpoint", () => {
      const payerAddress = "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ";
      const usage = [
        createMockUsageEvent({
          payerPublicKey: payerAddress
        })
      ];

      const result = getDetailedAnalytics(usage, []);

      // Should have hash, not full key
      expect(result.records[0].payerKeyHash).toBeDefined();
      expect(result.records[0]).not.toHaveProperty("payerPublicKey");

      const responseJson = JSON.stringify(result);
      expect(responseJson).not.toContain(payerAddress);
    });

    it("should never include query text", () => {
      const usage = [
        createMockUsageEvent({
          queryOrUrl: "SELECT * FROM users WHERE admin=true"
        })
      ];

      const result = getDetailedAnalytics(usage, []);

      expect(result.records[0]).not.toHaveProperty("queryOrUrl");
      const responseJson = JSON.stringify(result);
      expect(responseJson).not.toContain("SELECT * FROM");
    });

    it("should never include facilitator URL in records", () => {
      const usage = [
        createMockUsageEvent({
          facilitatorUrl: "http://secret:8080"
        })
      ];

      const result = getDetailedAnalytics(usage, []);

      expect(result.records[0]).not.toHaveProperty("facilitatorUrl");
    });
  });

  describe("Mixed Sensitive Data Scenarios", () => {
    it("should handle all sensitive fields simultaneously", () => {
      const usage = [
        createMockUsageEvent({
          queryOrUrl: "DELETE FROM audit_logs",
          payerPublicKey: "GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ",
          facilitatorUrl: "http://internal.secret.local:9000",
          paymentTxHash: "secret_tx_data_abc123"
        })
      ];

      const result = getPublicAnalytics(usage, []);
      const responseJson = JSON.stringify(result);

      // Verify none of the sensitive data appears
      expect(responseJson).not.toContain("DELETE FROM audit_logs");
      expect(responseJson).not.toContain("GBLL3LQVV3LYQKPYQ4H7KOCDT5TJFP4P4A5PEHQMWQ6WBSOVNBFPGJPZ");
      expect(responseJson).not.toContain("internal.secret.local");
      expect(responseJson).not.toContain("secret_tx_data");
    });

    it("should maintain aggregation despite redaction", () => {
      const usage = [
        createMockUsageEvent({
          queryOrUrl: "SELECT * FROM users",
          priceUsd: 0.01,
          paymentStatus: "paid"
        }),
        createMockUsageEvent({
          queryOrUrl: "SELECT * FROM orders",
          priceUsd: 0.02,
          paymentStatus: "demo-paid"
        })
      ];

      const result = getPublicAnalytics(usage, []);

      // Aggregation should be correct despite redacted query text
      expect(result.aggregation.settled.totalCount).toBe(1);
      expect(result.aggregation.settled.totalVolumeUsd).toBe(0.01);
      expect(result.aggregation.demoPaid.totalCount).toBe(1);
      expect(result.aggregation.demoPaid.totalVolumeUsd).toBe(0.02);
    });
  });

  describe("Response Structure Validation", () => {
    it("should only have safe fields in public response", () => {
      const usage = [createMockUsageEvent()];
      const result = getPublicAnalytics(usage, []);

      const record = result.recentRecords[0];

      // Allowed fields
      expect(record).toHaveProperty("id");
      expect(record).toHaveProperty("mode");
      expect(record).toHaveProperty("endpoint");
      expect(record).toHaveProperty("providerId");
      expect(record).toHaveProperty("priceUsd");
      expect(record).toHaveProperty("paymentStatus");
      expect(record).toHaveProperty("createdAt");
      expect(record).toHaveProperty("latencyMs");
      expect(record).toHaveProperty("traceId");

      // Forbidden fields
      expect(record).not.toHaveProperty("queryOrUrl");
      expect(record).not.toHaveProperty("facilitatorUrl");
      expect(record).not.toHaveProperty("paymentTxHash");
      expect(record).not.toHaveProperty("payerPublicKey");
    });

    it("should have limited safe fields in detailed response", () => {
      const usage = [createMockUsageEvent()];
      const result = getDetailedAnalytics(usage, []);

      const record = result.records[0];

      // Allowed fields
      expect(record).toHaveProperty("id");
      expect(record).toHaveProperty("mode");
      expect(record).toHaveProperty("endpoint");
      expect(record).toHaveProperty("providerId");
      expect(record).toHaveProperty("priceUsd");
      expect(record).toHaveProperty("paymentStatus");
      expect(record).toHaveProperty("createdAt");
      expect(record).toHaveProperty("latencyMs");
      expect(record).toHaveProperty("traceId");

      // Fields that may be present (within retention)
      // Should have hash, not raw value
      if (record.payerKeyHash !== undefined) {
        expect(typeof record.payerKeyHash).toBe("string");
        expect(record.payerKeyHash.length).toBe(16);
      }

      // Forbidden fields
      expect(record).not.toHaveProperty("queryOrUrl");
      expect(record).not.toHaveProperty("facilitatorUrl");
      expect(record).not.toHaveProperty("payerPublicKey");
    });
  });

  describe("Aggregation Accuracy With Sensitive Data", () => {
    it("should correctly count settled volume despite query redaction", () => {
      const usage = [
        createMockUsageEvent({
          queryOrUrl: "https://api.stripe.com/v1/charges?api_key=sk_test_...",
          priceUsd: 0.005,
          paymentStatus: "paid"
        }),
        createMockUsageEvent({
          queryOrUrl: "https://api.openai.com/v1/chat/completions?key=secret",
          priceUsd: 0.015,
          paymentStatus: "paid"
        })
      ];

      const result = getPublicAnalytics(usage, []);

      // Verify aggregation is accurate
      expect(result.aggregation.settled.totalVolumeUsd).toBe(0.02);
      expect(result.aggregation.settled.totalCount).toBe(2);

      // Verify no URLs leaked
      const responseJson = JSON.stringify(result);
      expect(responseJson).not.toContain("stripe.com");
      expect(responseJson).not.toContain("openai.com");
      expect(responseJson).not.toContain("sk_test");
    });

    it("should correctly separate demo and settled despite mixed sensitivity", () => {
      const usage = [
        createMockUsageEvent({
          queryOrUrl: "secret_demo_query",
          paymentStatus: "demo-paid",
          priceUsd: 0.01
        }),
        createMockUsageEvent({
          queryOrUrl: "secret_settled_query",
          paymentStatus: "paid",
          priceUsd: 0.02
        })
      ];

      const result = getPublicAnalytics(usage, []);

      expect(result.aggregation.demoPaid.totalVolumeUsd).toBe(0.01);
      expect(result.aggregation.settled.totalVolumeUsd).toBe(0.02);

      const responseJson = JSON.stringify(result);
      expect(responseJson).not.toContain("secret_");
    });
  });

  describe("Realistic Attack Scenarios", () => {
    it("should protect against SQL injection in queries", () => {
      const maliciousQuery = "'; DROP TABLE analytics; --";
      const usage = [
        createMockUsageEvent({
          queryOrUrl: maliciousQuery
        })
      ];

      const result = getPublicAnalytics(usage, []);
      const responseJson = JSON.stringify(result);

      expect(responseJson).not.toContain(maliciousQuery);
      expect(responseJson).not.toContain("DROP TABLE");
    });

    it("should protect against exposed API keys in URLs", () => {
      const urlWithApiKey = "https://api.example.com/data?apiKey=test_key_12345678abcdefgh";
      const usage = [
        createMockUsageEvent({
          queryOrUrl: urlWithApiKey
        })
      ];

      const result = getPublicAnalytics(usage, []);
      const responseJson = JSON.stringify(result);

      expect(responseJson).not.toContain("test_key_");
      expect(responseJson).not.toContain("apiKey");
    });

    it("should protect against internal IP addresses", () => {
      const internalUrl = "https://10.0.0.1:9000/internal/admin";
      const usage = [
        createMockUsageEvent({
          queryOrUrl: internalUrl
        })
      ];

      const result = getPublicAnalytics(usage, []);
      const responseJson = JSON.stringify(result);

      expect(responseJson).not.toContain("10.0.0.1");
    });

    it("should protect against exposed credentials", () => {
      const queryWithCredentials = "user:password@db.internal.local/sensitive_data";
      const usage = [
        createMockUsageEvent({
          queryOrUrl: queryWithCredentials
        })
      ];

      const result = getPublicAnalytics(usage, []);
      const responseJson = JSON.stringify(result);

      expect(responseJson).not.toContain("user:password");
      expect(responseJson).not.toContain("@db.internal");
    });
  });
});
