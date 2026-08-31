import { getProviderById, providers } from "../lib/pricing.js";
import { registry } from "../providers/index.js";
import { nanoid } from "nanoid";
import { QueryResult } from "@query402/shared";
import { validateScrapeUrl } from "../lib/scrape-url-safety.js";
import { logger } from "../lib/logger.js";

function getErrorClass(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name;
  }

  return typeof error;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/\b(url|targetUrl)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^,;]+)/gi, "$1=[redacted-url]")
    .replace(
      /\b(payment-response|x-payment-response|authorization)\b\s*[:=]\s*([^\s,;]+)/gi,
      "$1=[redacted]"
    )
    .replace(
      /\b(query|queryOrUrl|q|secret|api[_ -]?key|token|private[_ -]?key|privateKey|seed)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^,;]+)/gi,
      "$1=[redacted]"
    )
    .replace(/https?:\/\/\S+/gi, "[redacted-url]");
}

export class ProviderTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderTimeoutError";
  }
}

export class ProviderFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderFailedError";
  }
}

export async function executeQuery(params: {
  mode: "search" | "news" | "scrape";
  provider: string;
  q?: string;
  url?: string;
}): Promise<QueryResult> {
  const providerDef = getProviderById(params.provider);
  if (!providerDef) {
    throw new Error(`Provider not found or disabled: ${params.provider}`);
  }

  const queryOrUrl = params.mode === "scrape" ? params.url : params.q;
  if (!queryOrUrl) {
    throw new Error(`Input required for mode ${params.mode}`);
  }

  const safeInput = params.mode === "scrape" ? await validateScrapeUrl(queryOrUrl) : queryOrUrl;

  let execution;
  try {
    execution = await registry.execute(params.mode, params.provider, safeInput);
  } catch (error) {
    logger.error(
      {
        providerId: params.provider,
        mode: params.mode,
        errorClass: getErrorClass(error),
        errorMessage: sanitizeErrorMessage(getErrorMessage(error))
      },
      "provider execution failed"
    );
    const msg = getErrorMessage(error);
    if (msg.toLowerCase().includes("timeout")) {
      throw new ProviderTimeoutError(msg);
    }
    throw new ProviderFailedError(msg);
  }

  const latencyMs = execution.execution.observedDurationMs;

  return {
    mode: params.mode,
    providerId: providerDef.id,
    providerName: providerDef.name,
    priceUsd: providerDef.priceUsd,
    latencyMs,
    timestamp: new Date().toISOString(),
    traceId: `trace_${nanoid(12)}`,
    items: execution.items,
    source: execution.source,
    execution: execution.execution,
    raw: {
      queryOrUrl: safeInput,
      adapterId: params.provider
    }
  };
}

export function getCatalog() {
  const byCategory = {
    search: providers.filter((provider) => provider.category === "search"),
    news: providers.filter((provider) => provider.category === "news"),
    scrape: providers.filter((provider) => provider.category === "scrape")
  };

  return {
    updatedAt: new Date().toISOString(),
    providerCount: providers.length,
    providers,
    byCategory
  };
}

import { getUsageEvents } from "../lib/persistence.js";
import { formatPrivacySafeAnalytics } from "./analytics-privacy.js";
import { PaginatedAnalyticsResponse } from "@query402/shared";

/**
 * Fetches privacy-safe, cursor-paginated analytics data from the JSON file layer.
 */
export async function fetchPaginatedAnalytics(
  limit: number = 10,
  cursor: string | null = null
): Promise<PaginatedAnalyticsResponse> {
  // 1. Read all logs from our local JSON file storage engine
  const allEvents = getUsageEvents();

  let sliceStartIndex = 0;

  // 2. If a cursor is provided, find its index to start our next page chunk
  if (cursor) {
    const cursorIndex = allEvents.findIndex((event: any) => event.id === cursor);
    if (cursorIndex !== -1) {
      // Start slicing immediately after the cursor item
      sliceStartIndex = cursorIndex + 1;
    }
  }

  // 3. Extract the chunk + 1 extra item to check if a next page exists
  const fetchCount = limit + 1;
  const pageChunk = allEvents.slice(sliceStartIndex, sliceStartIndex + fetchCount);

  const hasMore = pageChunk.length > limit;
  // Trim down to the requested page limit
  const validRecords = hasMore ? pageChunk.slice(0, limit) : pageChunk;

  // 4. Filter and mask the records safely via our privacy module
  const cleanData = formatPrivacySafeAnalytics(validRecords);

  // 5. Pick the ID of the last element in our current view as the next cursor token
  const nextCursor = hasMore && cleanData.length > 0 ? cleanData[cleanData.length - 1].id : null;

  return {
    success: true,
    hasMore,
    nextCursor,
    data: cleanData
  };
}