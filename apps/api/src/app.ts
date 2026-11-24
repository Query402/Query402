import express from "express";
import cors from "cors";
import { publicRouter } from "./routes/public.js";
import { protectedRouter } from "./routes/protected.js";
import { paidRouter } from "./routes/demo.js";
import { sponsorshipRouter } from "./routes/sponsorship.js";
import { createX402Middleware } from "./lib/x402.js";
import { logger } from "./lib/logger.js";
import { config } from "./lib/config.js";
import { UnsafeScrapeUrlError } from "./lib/scrape-url-safety.js";
import { PaymentEvidenceError } from "./lib/payment-evidence.js";
import { createRequestIdMiddleware, REQUEST_ID_HEADER } from "./lib/request-id.js";

export const app = express();

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
app.use(createRequestIdMiddleware());
app.use(express.json());
app.use((req, res, next) => {
  logger.info(
    {
      requestId: res.locals.requestId,
      requestIdSource: res.locals.requestIdSource,
      method: req.method,
      url: req.url
    },
    "incoming request"
  );
  next();
});

app.use(publicRouter);
app.use(sponsorshipRouter);
app.use(createX402Middleware());
app.use(protectedRouter);
app.use(paidRouter);

app.use(
  (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof UnsafeScrapeUrlError) {
      res.status(400).json({
        error: "Scrape URL is not allowed",
        type: "unsafe_scrape_url"
      });
      return;
    }

    if (error instanceof PaymentEvidenceError) {
      res.status(400).json({
        error: error.message,
        type: "payment_evidence_error"
      });
      return;
    }

    res.status(500).json({
      error: error.message,
      type: "internal_error"
    });
  }
);
