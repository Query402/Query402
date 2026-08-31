import { Router } from "express";
import { z } from "zod";
import type { DemoScenarioManifest } from "@query402/shared";
import { buildCapabilityMatrix, getSortedProviders, providers } from "../lib/pricing.js";
import { getAnalyticsSummary, getUsageEvents, getSettlementDigest } from "../lib/persistence.js";
import { config, getConfigSnapshot, getFacilitatorConfigured } from "../lib/config.js";
import { apiVersion, buildMetadata } from "../lib/build-metadata.js";
import { getCatalog } from "../services/query-service.js";
import { MAX_EXPORT_SIZE, MAX_PAYMENT_ATTEMPTS, MAX_USAGE_EVENTS } from "../lib/storage/constants.js";
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

publicRouter.get("/api/readiness", async (_req, res) => {
  const facilitatorSupported = await checkFacilitatorSupported();

  const providersByMode = {
    live: providers.filter((p) => p.sourceType === "live").length,
    fallback: providers.filter((p) => p.sourceType !== "live").length
  };

  res.json({
    ok: true,
    version: buildMetadata.version,
    gitCommit: buildMetadata.gitCommit,
    buildTime: buildMetadata.buildTime,
    timestamp: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
    demoMode: config.demoMode,
    network: config.STELLAR_NETWORK,
    facilitatorConfigured: getFacilitatorConfigured(),
    facilitatorSupported: facilitatorSupported.ok,
    providersByMode,
    storageAvailable: isStorageAvailable()
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

publicRouter.get("/api/analytics", async (req, res, next) => {
  try {
    if (checkOverLimit(req.query.recentUsageLimit) || checkOverLimit(req.query.recentPaymentLimit)) {
      return res.status(400).json(overLimitErrorPayload);
    }

    const parsed = analyticsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const analytics = await getAnalyticsSummary({
      recentUsageLimit: parsed.data.recentUsageLimit,
      recentPaymentLimit: parsed.data.recentPaymentLimit
    });
    res.json(analytics);
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/api/audit/digest", async (_req, res, next) => {
  try {
    const digest = await getSettlementDigest();
    res.json(digest);
  } catch (error) {
    next(error);
  }
});

const DEMO_SCENARIO_MANIFEST: DemoScenarioManifest = {
  scenarios: [
    {
      id: "search-provider-comparison",
      mode: "search",
      recommendedProvider: "search.basic",
      sampleQuery: "latest stellar x402 updates",
      expectedEvidenceFields: [
        "providerId",
        "providerName",
        "priceUsd",
        "latencyMs",
        "timestamp",
        "traceId",
        "items",
        "source",
        "execution"
      ],
      worksInDemoMode: true,
      worksInRealMode: true
    },
    {
      id: "news-payment-flow",
      mode: "news",
      recommendedProvider: "news.fast",
      sampleQuery: "stablecoin micropayments",
      expectedEvidenceFields: [
        "providerId",
        "providerName",
        "priceUsd",
        "latencyMs",
        "timestamp",
        "traceId",
        "items",
        "source",
        "execution"
      ],
      worksInDemoMode: true,
      worksInRealMode: true
    },
    {
      id: "scrape-result-display",
      mode: "scrape",
      recommendedProvider: "scrape.page",
      sampleQuery: "https://developers.stellar.org",
      expectedEvidenceFields: [
        "providerId",
        "providerName",
        "priceUsd",
        "latencyMs",
        "timestamp",
        "traceId",
        "items",
        "source",
        "execution"
      ],
      worksInDemoMode: true,
      worksInRealMode: true
    }
  ]
};

publicRouter.get("/api/scenarios", (_req, res) => {
  res.json(DEMO_SCENARIO_MANIFEST);
});
