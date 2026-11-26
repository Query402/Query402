import express from "express";
import cors from "cors";
import { publicRouter } from "./routes/public.js";
import { protectedRouter } from "./routes/protected.js";
import { paidRouter } from "./routes/demo.js";
import { sponsorshipRouter } from "./routes/sponsorship.js";
import { createX402Middleware } from "./lib/x402.js";
import { securityHeaders } from "./lib/security-headers.js";
import { logger } from "./lib/logger.js";
import { config } from "./lib/config.js";
import { UnsafeScrapeUrlError } from "./lib/scrape-url-safety.js";
import { PaymentEvidenceError } from "./lib/payment-evidence.js";
import {
  ProviderTimeoutError,
  ProviderFailedError,
  sanitizeErrorMessage
} from "./services/query-service.js";
import { ProviderCatalogConflictError } from "./lib/pricing.js";
import { createChallengeRateLimit, isUnpaidX402Request } from "./lib/challenge-rate-limit.js";
import { createRequestIdMiddleware, REQUEST_ID_HEADER } from "./lib/request-id.js";

const UNKNOWN_INTERNAL_ERROR_MESSAGE = "Internal server error";

function logUnclassifiedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  logger.error(
    {
      errorClass: error instanceof Error && error.name ? error.name : typeof error,
      errorMessage: sanitizeErrorMessage(message),
      ...(stack ? { errorStack: sanitizeErrorMessage(stack) } : {})
    },
    "unhandled request error"
  );
}

export function handleApiError(
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction
) {
  if (error instanceof UnsafeScrapeUrlError) {
    res.status(400).json({
      error: "Scrape URL is not allowed",
      type: "unsafe_scrape_url",
      errorCode: "invalid_query"
    });
    return;
  }

  if (error instanceof PaymentEvidenceError) {
    res.status(400).json({
      error: error.message,
      type: "payment_evidence_error",
      errorCode: "payment_invalid"
    });
    return;
  }

  if (error instanceof ProviderTimeoutError) {
    res.status(504).json({
      error: error.message,
      type: "provider_timeout",
      errorCode: "provider_timeout"
    });
    return;
  }

  if (error instanceof ProviderFailedError) {
    res.status(502).json({
      error: error.message,
      type: "provider_failed",
      errorCode: "provider_failed"
    });
    return;
  }

  if (error instanceof ProviderCatalogConflictError) {
    res.status(409).json({
      error: error.message,
      type: "provider_catalog_conflict",
      errorCode: error.code,
      providerIds: error.providerIds
    });
    return;
  }

  logUnclassifiedError(error);
  res.status(500).json({
    error: UNKNOWN_INTERNAL_ERROR_MESSAGE,
    type: "internal_error",
    errorCode: "internal_error"
  });
}

export const app = express();

app.disable("x-powered-by");

const defaultDevelopmentOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

const allowedOrigins =
  config.corsOrigins.length > 0
    ? config.corsOrigins
    : config.NODE_ENV === "production"
      ? []
      : defaultDevelopmentOrigins;

function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/+$/, "").toLowerCase();
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(normalizeOrigin(origin))) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    exposedHeaders: [
      "payment-required",
      "payment-response",
      "x-payment-response",
      REQUEST_ID_HEADER
    ]
  })
);
app.use(securityHeaders());
app.use(createRequestIdMiddleware());
app.use(express.json({ limit: config.API_JSON_BODY_MAX_BYTES }));
export function logApiRequest(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  // `req.url` includes the query string. Paid queries and scrape targets are
  // user-controlled and must not be copied into application logs.
  logger.info(
    {
      requestId: res.locals.requestId,
      requestIdSource: res.locals.requestIdSource,
      method: req.method,
      path: req.path
    },
    "incoming request"
  );
  next();
}

app.use(logApiRequest);

app.use(publicRouter);
app.use(sponsorshipRouter);
app.use(
  createChallengeRateLimit({
    limit: config.CHALLENGE_RATE_LIMIT_PER_MINUTE,
    maxClients: config.CHALLENGE_RATE_LIMIT_MAX_CLIENTS,
    shouldLimit: isUnpaidX402Request
  })
);
app.use(createX402Middleware());
app.use(protectedRouter);
app.use(paidRouter);

function isJsonBodyTooLarge(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
    cause?: unknown;
  };

  if (candidate.type === "entity.too.large") {
    return true;
  }

  if (candidate.status === 413 || candidate.statusCode === 413) {
    return true;
  }

  if (candidate.cause && candidate.cause !== error) {
    return isJsonBodyTooLarge(candidate.cause);
  }

  return false;
}

// Oversized JSON is rejected before the route runs. Keep the payload out of logs
// and out of the response; clients branch on errorCode.
app.use(
  (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!isJsonBodyTooLarge(error)) {
      next(error);
      return;
    }

    res.status(413).json({
      error: "JSON request body exceeds the configured size limit",
      type: "json_body_too_large",
      errorCode: "json_body_too_large"
    });
  }
);

app.use(handleApiError);
