import { Router } from "express";
import { z } from "zod";
import { buildCapabilityMatrix, getSortedProviders } from "../lib/pricing.js";
import { getAnalyticsSummary, getUsageEvents } from "../lib/persistence.js";
import { config, getFacilitatorConfigured } from "../lib/config.js";
import { apiVersion, buildMetadata } from "../lib/build-metadata.js";
import { getCatalog } from "../services/query-service.js";
import { MAX_USAGE_EVENTS } from "../lib/storage/constants.js";
import { isStorageAvailable } from "../lib/storage/index.js";
import { checkFacilitatorSupported } from "../lib/facilitator-check.js";

export const publicRouter = Router();

function checkOverLimit(val: unknown): boolean {
  if (val === undefined || val === null || val === "") return false;
  const num = Number(val);
  return !Number.isNaN(num) && num > MAX_EXPORT_SIZE;
}

const overLimitErrorPayload = {
  error: "over_limit_export_size",
  message: `Export row limit exceeds maximum allowed size of ${MAX_EXPORT_SIZE}`,
  max: MAX_EXPORT_SIZE
};

const usageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_USAGE_EVENTS).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

const analyticsQuerySchema = z.object({
  recentUsageLimit: z.coerce.number().int().min(1).max(MAX_USAGE_EVENTS).optional(),
  recentPaymentLimit: z.coerce.number().int().min(1).max(MAX_PAYMENT_ATTEMPTS).optional()
});

publicRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "query402-api",
    version: apiVersion,
    nodeEnv: config.NODE_ENV,
    network: config.STELLAR_NETWORK,
    sponsorshipEnabled: config.sponsorshipEnabled,
    demoMode: config.demoMode,
    timestamp: new Date().toISOString(),


    uptimeSeconds: process.uptime(),
    diagnostics: getConfigSnapshot()

  });
});

publicRouter.get("/api/providers", (_req, res) => {
  res.json({ providers: getSortedProviders() });
});

publicRouter.get("/api/catalog", (_req, res) => {
  res.json(getCatalog());
});

publicRouter.get("/api/matrix", (_req, res) => {
  res.json({
    updatedAt: new Date().toISOString(),
    providers: buildCapabilityMatrix()
  });
});

publicRouter.get("/api/usage", async (req, res, next) => {
  try {
    if (checkOverLimit(req.query.limit)) {
      return res.status(400).json(overLimitErrorPayload);
    }

    const parsed = usageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const usage = await getUsageEvents({
      limit: parsed.data.limit,
      offset: parsed.data.offset
    });

    res.json({
      usage,
      pagination: {
        limit: parsed.data.limit ?? usage.length,
        offset: parsed.data.offset ?? 0,
        count: usage.length
      }
    });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/api/export", async (_req, res, next) => {
  try {
    const exportData = await getAnalyticsExport();
    res.json(exportData);
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/api/analytics", async (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const cursor = req.query.cursor ? (req.query.cursor as string) : null;

    const result = await fetchPaginatedAnalytics(limit, cursor);
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * Public analytics endpoint - privacy-safe aggregation and paginated records
 * No raw query text, URLs, or full payer addresses
 * GET /api/v1/analytics?cursor=<cursor>&limit=<limit>
 */
publicRouter.get("/api/v1/analytics", (_req, res) => {
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

    const analytics = getPublicAnalyticsData(cursor, limit);
    res.json(analytics);
  } catch (error: any) {
    res.status(400).json({
      error: "Invalid analytics request",
      message: error?.message ?? "Unknown error"
    });
  }
});
