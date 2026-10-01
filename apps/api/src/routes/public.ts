import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { DemoScenarioManifest } from "@query402/shared";
import { buildCapabilityMatrix, getSortedProviders, providers } from "../lib/pricing.js";
import { getAnalyticsSummary, getUsageEvents, getSettlementDigest } from "../lib/persistence.js";
import { config, getConfigSnapshot, getFacilitatorConfigured } from "../lib/config.js";
import { apiVersion, buildMetadata } from "../lib/build-metadata.js";
import { listProviderMetadata } from "../providers/metadata.js";
import {
  MAX_EXPORT_SIZE,
  MAX_PAYMENT_ATTEMPTS,
  MAX_USAGE_EVENTS
} from "../lib/storage/constants.js";
import { isStorageAvailable } from "../lib/storage/index.js";
import { checkFacilitatorSupported } from "../lib/facilitator-check.js";
import { isSchemaCurrent } from "../lib/storage/sqlite/store.js";

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

// Public provider routes serve catalog metadata only. Query input is rejected
// here so a provider can never run without passing through the paid x402 route.
const PROVIDER_METADATA_PATHS = ["/api/providers", "/api/catalog", "/api/matrix"];
const QUERY_PARAM_KEYS = ["q", "query", "url"];

const publicQueryRejectedPayload = {
  error: "Public provider routes return metadata only; run queries through the paid /x402 routes",
  type: "public_query_rejected",
  errorCode: "invalid_query"
};

function isQueryShaped(req: Request): boolean {
  if (QUERY_PARAM_KEYS.some((key) => req.query[key] !== undefined)) return true;
  if (Number(req.headers["content-length"] ?? 0) > 0) return true;
  if (req.headers["transfer-encoding"] !== undefined) return true;
  return typeof req.body === "object" && req.body !== null && Object.keys(req.body).length > 0;
}

// Payment headers are intentionally ignored: a public request carrying one is
// still not a paid query and gets the same metadata-only response.
function rejectQueryShapedRequest(req: Request, res: Response, next: NextFunction) {
  if (isQueryShaped(req)) {
    return res.status(400).json(publicQueryRejectedPayload);
  }
  next();
}

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
  let schemaReady = config.analyticsStorage !== "sqlite";
  if (config.analyticsStorage === "sqlite") {
    try {
      schemaReady = isSchemaCurrent(config.analyticsDbPath);
    } catch {
      schemaReady = false;
    }
  }

  const providersByMode = {
    live: providers.filter((p) => p.sourceType === "live").length,
    fallback: providers.filter((p) => p.sourceType !== "live").length
  };

  res.status(schemaReady ? 200 : 503).json({
    ok: schemaReady,
    schemaReady,
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

publicRouter.get("/api/providers", rejectQueryShapedRequest, (_req, res) => {
  res.json({ providers: getSortedProviders() });
});

publicRouter.get("/api/catalog", rejectQueryShapedRequest, (_req, res) => {
  const metadata = listProviderMetadata();
  res.json({
    updatedAt: new Date().toISOString(),
    providerCount: metadata.length,
    providers: metadata
  });
});

publicRouter.get("/api/matrix", rejectQueryShapedRequest, (_req, res) => {
  res.json({
    updatedAt: new Date().toISOString(),
    providers: buildCapabilityMatrix()
  });
});

publicRouter.all(PROVIDER_METADATA_PATHS, (_req, res) => {
  res.set("Allow", "GET");
  res.status(405).json({
    error: "Public provider routes are read-only metadata; use GET",
    type: "method_not_allowed",
    errorCode: "invalid_query"
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
    if (
      checkOverLimit(req.query.recentUsageLimit) ||
      checkOverLimit(req.query.recentPaymentLimit)
    ) {
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
