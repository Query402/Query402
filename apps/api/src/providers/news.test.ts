import { describe, it, expect, vi, beforeEach } from "vitest";
import { NewsAdapter, UnauthorizedProviderAccessError } from "./news.js";
import * as groq from "../lib/groq.js";

vi.mock("../lib/groq.js");

describe("NewsAdapter", () => {
  let adapter: NewsAdapter;

  beforeEach(() => {
    adapter = new NewsAdapter("news.fast");
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
        "Provider news.fast requires payment verification"
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
          title: "Breaking news",
          url: "https://news.example.com/article",
          snippet: "Important update",
          score: 0.9
        }
      ];

      vi.mocked(groq.fetchGroqItems).mockResolvedValueOnce(mockItems);

      const result = await adapter.execute("test query", {
        paymentReference: "tx-abc123",
        safetyPassed: true
      });

      expect(result).toEqual(mockItems);
      expect(groq.fetchGroqItems).toHaveBeenCalledOnce();
      expect(groq.fetchGroqItems).toHaveBeenCalledWith("news", "test query");
    });

    it("should call upstream once with demo payment reference", async () => {
      const mockItems = [
        {
          title: "Demo news",
          url: "https://news.example.com/demo",
          snippet: "Demo content",
          score: 0.85
        }
      ];

      vi.mocked(groq.fetchGroqItems).mockResolvedValueOnce(mockItems);

      const result = await adapter.execute("demo query", {
        paymentReference: "demo:/x402/news:news.fast:demo-agent",
        safetyPassed: true
      });

      expect(result).toEqual(mockItems);
      expect(groq.fetchGroqItems).toHaveBeenCalledOnce();
      expect(groq.fetchGroqItems).toHaveBeenCalledWith("news", "demo query");
    });

    it("should throw error when upstream returns no items", async () => {
      vi.mocked(groq.fetchGroqItems).mockResolvedValueOnce(null);

      await expect(
        adapter.execute("test query", {
          paymentReference: "tx-abc123",
          safetyPassed: true
        })
      ).rejects.toThrow("No items returned from news provider");

      expect(groq.fetchGroqItems).toHaveBeenCalledOnce();
    });

    it("should throw error when upstream returns empty array", async () => {
      vi.mocked(groq.fetchGroqItems).mockResolvedValueOnce([]);

      await expect(
        adapter.execute("test query", {
          paymentReference: "tx-abc123",
          safetyPassed: true
        })
      ).rejects.toThrow("No items returned from news provider");

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
      const result = adapter.getFallback("stellar payments");

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        title: expect.stringContaining("stellar payments"),
        url: expect.any(String),
        snippet: expect.any(String),
        score: expect.any(Number)
      });
    });

    it("should include query in fallback items", () => {
      const query = "blockchain technology";
      const result = adapter.getFallback(query);

      expect(result[0].title).toContain(query);
    });
  });
});
