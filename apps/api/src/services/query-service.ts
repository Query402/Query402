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
    throw error;
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
