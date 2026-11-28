import { describe, it, expect, vi, beforeEach } from "vitest";
import { SearchAdapter, UnauthorizedProviderAccessError } from "./search.js";
import * as groq from "../lib/groq.js";

vi.mock("../lib/groq.js");

describe("SearchAdapter", () => {
  let adapter: SearchAdapter;

  beforeEach(() => {
    adapter = new SearchAdapter("search.basic");
    vi.clearAllMocks();
  });

  describe("isHealthy", () => {
    it("should always return true", async () => {
      const healthy = await adapter.isHealthy();
      expect(healthy).toBe(true);
    });
  });

  describe("execute", () => {
    it("should reject call with no payment reference", async () => {
      await expect(adapter.execute("test query")).rejects.toThrow(
        UnauthorizedProviderAccessError
      );
      await expect(adapter.execute("test query")).rejects.toThrow(
        "Provider search.basic requires payment verification"
      );

      // Ensure upstream HTTP call was NOT made
      expect(groq.fetchGroqItems).not.toHaveBeenCalled();
    });

    it("should reject call with empty payment reference", async () => {
      await expect(
        adapter.execute("test query", {
          paymentReference: "",
          safetyPassed: true
        })
      ).rejects.toThrow(UnauthorizedProviderAccessError);

      // Ensure upstream HTTP call was NOT made
      expect(groq.fetchGroqItems).not.toHaveBeenCalled();
    });

    it("should reject call with failed safety flag", async () => {
      await expect(
        adapter.execute("test query", {
          paymentReference: "tx-abc123",
          safetyPassed: false
        })
      ).rejects.toThrow(UnauthorizedProviderAccessError);

      // Ensure upstream HTTP call was NOT made
      expect(groq.fetchGroqItems).not.toHaveBeenCalled();
    });

    it("should reject call with missing context", async () => {
      await expect(adapter.execute("test query", undefined)).rejects.toThrow(
        UnauthorizedProviderAccessError
      );

      // Ensure upstream HTTP call was NOT made
      expect(groq.fetchGroqItems).not.toHaveBeenCalled();
    });

    it("should call upstream once with valid paid context", async () => {
      const mockItems = [
        {
          title: "Search result",
          url: "https://example.com/page",
          snippet: "Relevant content",
          score: 0.92
        }
      ];

      vi.mocked(groq.fetchGroqItems).mockResolvedValueOnce(mockItems);

      const result = await adapter.execute("test query", {
        paymentReference: "tx-abc123",
        safetyPassed: true
      });

      expect(result).toEqual(mockItems);
      expect(groq.fetchGroqItems).toHaveBeenCalledOnce();
      expect(groq.fetchGroqItems).toHaveBeenCalledWith("search", "test query");
    });

    it("should call upstream once with demo payment reference", async () => {
      const mockItems = [
        {
          title: "Demo search result",
          url: "https://example.com/demo",
          snippet: "Demo content",
          score: 0.88
        }
      ];

      vi.mocked(groq.fetchGroqItems).mockResolvedValueOnce(mockItems);

      const result = await adapter.execute("demo query", {
        paymentReference: "demo:/x402/search:search.basic:demo-agent",
        safetyPassed: true
      });

      expect(result).toEqual(mockItems);
      expect(groq.fetchGroqItems).toHaveBeenCalledOnce();
      expect(groq.fetchGroqItems).toHaveBeenCalledWith("search", "demo query");
    });

    it("should throw error when upstream returns no items", async () => {
      vi.mocked(groq.fetchGroqItems).mockResolvedValueOnce(null);

      await expect(
        adapter.execute("test query", {
          paymentReference: "tx-abc123",
          safetyPassed: true
        })
      ).rejects.toThrow("No items returned from search provider");

      expect(groq.fetchGroqItems).toHaveBeenCalledOnce();
    });

    it("should throw error when upstream returns empty array", async () => {
      vi.mocked(groq.fetchGroqItems).mockResolvedValueOnce([]);

      await expect(
        adapter.execute("test query", {
          paymentReference: "tx-abc123",
          safetyPassed: true
        })
      ).rejects.toThrow("No items returned from search provider");

      expect(groq.fetchGroqItems).toHaveBeenCalledOnce();
    });

    it("should not expose upstream URL in error message", async () => {
      try {
        await adapter.execute("test query");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Ensure error message doesn't contain upstream URL patterns
        expect(errorMessage).not.toMatch(/groq\.com/i);
        expect(errorMessage).not.toMatch(/https?:\/\//);
        expect(errorMessage).not.toMatch(/api\./);
      }
    });
  });

  describe("getFallback", () => {
    it("should return deterministic fallback data", () => {
      const result = adapter.getFallback("stellar x402");

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        title: expect.any(String),
        url: expect.any(String),
        snippet: expect.any(String),
        score: expect.any(Number)
      });
    });

    it("should include current date in first result", () => {
      const result = adapter.getFallback("test query");
      const datePattern = /\d{4}-\d{2}-\d{2}/;

      expect(result[0].title).toMatch(datePattern);
    });

    it("should include query in snippet", () => {
      const query = "blockchain";
      const result = adapter.getFallback(query);

      expect(result[0].snippet).toContain(query);
    });
  });
});
