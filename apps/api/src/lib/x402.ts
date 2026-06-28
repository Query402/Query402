import { HTTPFacilitatorClient } from "@x402/core/server";
import {
  paymentMiddlewareFromHTTPServer,
  x402HTTPResourceServer,
  x402ResourceServer
} from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import type { NextFunction, Request, Response } from "express";
import type { HTTPRequestContext } from "@x402/core/server";
import type { PaymentPayload } from "@x402/core/types";
import { getProviderById, protectedRouteBasePrices } from "./pricing.js";
import { config } from "./config.js";
import {
  buildDemoPaymentEvidence,
  buildEvidenceFromHttpContext,
  formatUsdPrice,
  getPaidRequestRecord,
  persistPaymentEvidence,
  requestFromHttpContext,
  requirementsFromPaymentHeader,
  setPaymentEvidence
} from "./payment-evidence.js";

type RouteMode = "search" | "news" | "scrape";
type EvidenceRequest = Request & {
  paymentEvidencePersisted?: boolean;
};

const basePriceByMode: Record<RouteMode, string> = {
  search: protectedRouteBasePrices["GET /x402/search"] ?? "$0.01",
  news: protectedRouteBasePrices["GET /x402/news"] ?? "$0.015",
  scrape: protectedRouteBasePrices["GET /x402/scrape"] ?? "$0.02"
};

function getProviderFromContext(context: HTTPRequestContext) {
  const rawProvider =
    context.adapter.getQueryParam?.("provider") ?? context.adapter.getQueryParams?.()["provider"];

  if (Array.isArray(rawProvider)) {
    return rawProvider[0];
  }

  return rawProvider;
}

function resolveRoutePrice(context: HTTPRequestContext, mode: RouteMode) {
  const providerId = getProviderFromContext(context);
  if (!providerId) {
    return basePriceByMode[mode];
  }

  const provider = getProviderById(providerId);
  if (!provider || provider.category !== mode) {
    return basePriceByMode[mode];
  }

  return formatUsdPrice(provider.priceUsd);
}

function clonePaymentPayload(paymentPayload: unknown): PaymentPayload | undefined {
  if (!paymentPayload) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(paymentPayload)) as PaymentPayload;
}

function demoMode402Middleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/x402/")) {
    return next();
  }

  const paidHeader = req.header("x-query402-demo-paid");

  if (paidHeader === "true") {
    try {
      setPaymentEvidence(req, buildDemoPaymentEvidence(req));
    } catch (error) {
      return next(error);
    }
    return next();
  }

  const routeKey = `${req.method.toUpperCase()} ${req.path}`;
  const price = protectedRouteBasePrices[routeKey] ?? "$0.01";

  return res.status(402).json({
    error: "Payment Required",
    demoMode: true,
    accepts: {
      scheme: "exact",
      network: config.STELLAR_NETWORK,
      price,
      payTo: config.X402_PAY_TO_ADDRESS,
      facilitator: config.X402_FACILITATOR_URL
    },
    instructions:
      "For deterministic demo mode, retry with header x-query402-demo-paid: true. Demo evidence is recorded separately from settled x402 payments."
  });
}

export function createX402Middleware() {
  if (config.demoMode) {
    return demoMode402Middleware;
  }

  const network = config.STELLAR_NETWORK as `${string}:${string}`;

  const createAuthHeaders =
    config.X402_FACILITATOR_API_KEY && config.X402_FACILITATOR_API_KEY.length > 0
      ? async () => {
          const authHeaders = { Authorization: `Bearer ${config.X402_FACILITATOR_API_KEY}` };
          return {
            verify: authHeaders,
            settle: authHeaders,
            supported: authHeaders
          };
        }
      : undefined;

  const facilitatorClient = new HTTPFacilitatorClient({
    url: config.X402_FACILITATOR_URL,
    createAuthHeaders
  });

  const resourceServer = new x402ResourceServer(facilitatorClient).register(
    network,
    new ExactStellarScheme()
  );

  const settlementFailedResponseBody = async (
    context: HTTPRequestContext,
    settleResult: { errorReason?: string; errorMessage?: string }
  ) => {
    const req = requestFromHttpContext(context);
    const requirements = requirementsFromPaymentHeader(context.paymentHeader);
    if (req && requirements && !(req as EvidenceRequest).paymentEvidencePersisted) {
      const evidence = buildEvidenceFromHttpContext({
        context,
        requirements,
        failure: settleResult.errorReason ?? settleResult.errorMessage ?? "settlement_failed"
      });
      setPaymentEvidence(req, evidence);
      await persistPaymentEvidence(evidence, getPaidRequestRecord(req));
      (req as EvidenceRequest).paymentEvidencePersisted = true;
    }

    return {
      contentType: "application/json",
      body: { error: "Payment settlement failed", type: "payment_settlement_failed" }
    };
  };

  const routeConfig = {
    "GET /x402/search": {
      accepts: {
        scheme: "exact",
        network,
        price: (context: HTTPRequestContext) => resolveRoutePrice(context, "search"),
        payTo: config.X402_PAY_TO_ADDRESS
      },
      description: "Paid search endpoint on Query402",
      settlementFailedResponseBody
    },
    "GET /x402/news": {
      accepts: {
        scheme: "exact",
        network,
        price: (context: HTTPRequestContext) => resolveRoutePrice(context, "news"),
        payTo: config.X402_PAY_TO_ADDRESS
      },
      description: "Paid news endpoint on Query402",
      settlementFailedResponseBody
    },
    "GET /x402/scrape": {
      accepts: {
        scheme: "exact",
        network,
        price: (context: HTTPRequestContext) => resolveRoutePrice(context, "scrape"),
        payTo: config.X402_PAY_TO_ADDRESS
      },
      description: "Paid scrape endpoint on Query402",
      settlementFailedResponseBody
    }
  };

  resourceServer.onAfterSettle(async (context) => {
    const transportContext = context.transportContext;
    const httpContext =
      transportContext && typeof transportContext === "object" && "request" in transportContext
        ? (transportContext.request as HTTPRequestContext | undefined)
        : undefined;
    const req = httpContext ? requestFromHttpContext(httpContext) : undefined;
    if (!req) {
      return;
    }

    if (!httpContext) {
      return;
    }

    const evidence = buildEvidenceFromHttpContext({
      context: httpContext,
      requirements: context.requirements,
      paymentPayload: clonePaymentPayload(context.paymentPayload),
      settleResult: context.result
    });
    setPaymentEvidence(req, evidence);
    await persistPaymentEvidence(evidence, getPaidRequestRecord(req));
    (req as EvidenceRequest).paymentEvidencePersisted = true;
  });

  const httpServer = new x402HTTPResourceServer(resourceServer, routeConfig);
  return paymentMiddlewareFromHTTPServer(httpServer);
}
