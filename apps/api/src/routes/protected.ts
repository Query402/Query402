import { Router } from "express";
import { searchQuerySchema, newsQuerySchema, scrapeQuerySchema } from "@query402/shared";
import { executeQuery } from "../services/query-service.js";
import { config } from "../lib/config.js";
import { savePaymentAttempt, saveUsageEvent, getDetailedAnalyticsData } from "../lib/persistence.js";

export const protectedRouter = Router();

protectedRouter.get("/x402/search", async (req, res, next) => {
  const parsed = searchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten(), errorCode: "invalid_query" });
  }

  return handlePaidX402Route(req, res, next, {
    mode: "search",
    route: "/x402/search",
    provider: parsed.data.provider,
    queryOrUrl: parsed.data.q,
    query: parsed.data.q,
    execute: () =>
      executeQuery({
        mode: "search",
        provider: parsed.data.provider,
        q: parsed.data.q
      })
  });
});

protectedRouter.get("/x402/news", async (req, res, next) => {
  const parsed = newsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten(), errorCode: "invalid_query" });
  }

  return handlePaidX402Route(req, res, next, {
    mode: "news",
    route: "/x402/news",
    provider: parsed.data.provider,
    queryOrUrl: parsed.data.q,
    query: parsed.data.q,
    execute: () =>
      executeQuery({
        mode: "news",
        provider: parsed.data.provider,
        q: parsed.data.q
      })
  });
});

protectedRouter.get("/x402/scrape", async (req, res, next) => {
  const parsed = scrapeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten(), errorCode: "invalid_query" });
  }

  return handlePaidX402Route(req, res, next, {
    mode: "scrape",
    route: "/x402/scrape",
    provider: parsed.data.provider,
    queryOrUrl: parsed.data.url,
    url: parsed.data.url,
    execute: () =>
      executeQuery({
        mode: "scrape",
        provider: parsed.data.provider,
        url: parsed.data.url
      })
  });
});

/**
 * Detailed analytics endpoint - for authorized access only
 * Includes transaction hashes and payer key hashes (but never full addresses)
 * GET /x402/analytics/detailed?cursor=<cursor>&limit=<limit>
 */
protectedRouter.get("/x402/analytics/detailed", (_req, res, next) => {
  try {
    const cursor = typeof _req.query.cursor === "string" ? _req.query.cursor : undefined;
    const limit = typeof _req.query.limit === "string" ? parseInt(_req.query.limit, 10) : undefined;

    // Validate limit
    if (limit !== undefined && (isNaN(limit) || limit < 1 || limit > 100)) {
      return res.status(400).json({
        error: "Invalid limit parameter",
        message: "limit must be a number between 1 and 100"
      });
    }

    const analytics = getDetailedAnalyticsData(cursor, limit);
    res.json(analytics);
  } catch (error: any) {
    res.status(400).json({
      error: "Invalid analytics request",
      message: error?.message ?? "Unknown error"
    });
  }
});
