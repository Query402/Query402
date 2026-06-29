import { Router, type Response } from "express";
import { signedGrantSchema, type QueryResult, type SignedGrant } from "@query402/shared";
import { z } from "zod";
import { runPaidRequest } from "../lib/demo-client.js";
import {
  abortIdempotency,
  beginIdempotency,
  completeIdempotency,
  respondIdempotencyGate
} from "../lib/idempotency/route.js";
import { persistSponsoredPayment } from "../lib/persistence.js";
import { getProviderById } from "../lib/pricing.js";
import { config } from "../lib/config.js";
import {
  checkAndReserveBudget,
  commitBudget,
  releaseBudget,
  SponsorshipBudgetExceededError,
  SponsorshipNonceReplayError
} from "../lib/sponsorship/budget.js";
import { authorizeSponsoredRun } from "../lib/sponsorship/policy.js";

const stellarPublicKeySchema = z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar public key");

const paidRunSchema = z
  .object({
    mode: z.enum(["search", "news", "scrape"]),
    provider: z.string().min(1),
    wallet: stellarPublicKeySchema,
    query: z.string().optional(),
    url: z.string().url().optional()
  })
  .superRefine((data, context) => {
    if (data.mode === "scrape") {
      if (!data.url) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "url is required for scrape mode",
          path: ["url"]
        });
      }
      return;
    }

    if (!data.query) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "query is required for search/news mode",
        path: ["query"]
      });
    }
  });

function parseSignedGrantHeader(value: string | undefined): SignedGrant | null {
  if (!value) {
    return null;
  }

  const candidates = [value];

  try {
    candidates.push(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    // Header may already be raw JSON.
  }

  for (const candidate of candidates) {
    try {
      const parsed = signedGrantSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function policyErrorResponse(res: Response, policy: ReturnType<typeof authorizeSponsoredRun>) {
  return res.status(policy.statusCode).json({
    error: policy.error,
    decision: policy.decision,
    grantId: policy.grantId
  });
}

export const paidRouter = Router();

paidRouter.post("/api/paid/run", async (req, res, next) => {
  try {
    const parsed = paidRunSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const signedGrant = parseSignedGrantHeader(req.get("X-Sponsorship-Grant") ?? undefined);
    if (!signedGrant) {
      return res.status(403).json({ error: "invalid_grant" });
    }

    const catalogProvider = getProviderById(parsed.data.provider);
    if (!catalogProvider || catalogProvider.category !== parsed.data.mode) {
      return res.status(400).json({ error: "unknown_provider" });
    }

    const fingerprint = {
      method: "POST" as const,
      route: "/api/paid/run",
      mode: parsed.data.mode,
      provider: parsed.data.provider,
      query: parsed.data.query,
      url: parsed.data.url,
      payer: parsed.data.wallet,
      network: config.STELLAR_NETWORK,
      quotedAmountUsd: catalogProvider.priceUsd
    };

    const idempotencyGate = beginIdempotency(req, fingerprint);
    if (respondIdempotencyGate(res, idempotencyGate)) {
      return;
    }

    const authorizeInput = {
      signedGrant,
      wallet: parsed.data.wallet,
      mode: parsed.data.mode,
      provider: parsed.data.provider
    };

    const policy = authorizeSponsoredRun(authorizeInput);
    if (!policy.allowed) {
      abortIdempotency(req);
      return policyErrorResponse(res, policy);
    }

    const { grant } = signedGrant;
    const quotedPriceUsd = policy.quotedPriceUsd;
    if (quotedPriceUsd === undefined) {
      abortIdempotency(req);
      return res.status(503).json({ error: "sponsorship_storage_unavailable" });
    }

    try {
      checkAndReserveBudget({
        wallet: grant.wallet,
        amountUsd: quotedPriceUsd,
        nonce: grant.nonce,
        grantId: grant.grantId
      });
    } catch (error) {
      abortIdempotency(req);
      if (error instanceof SponsorshipNonceReplayError) {
        return res.status(409).json({ error: "nonce_replay", grantId: grant.grantId });
      }

      if (error instanceof SponsorshipBudgetExceededError) {
        return res.status(429).json({
          error: `${error.scope}_budget_exceeded`,
          grantId: grant.grantId
        });
      }

      return res.status(503).json({ error: "sponsorship_storage_unavailable" });
    }

    let output;
    try {
      output = await runPaidRequest({
        mode: parsed.data.mode,
        provider: parsed.data.provider,
        query: parsed.data.query,
        url: parsed.data.url
      });
    } catch (error) {
      releaseBudget(grant.wallet, quotedPriceUsd);
      abortIdempotency(req);
      throw error;
    }

    if (!output.ok) {
      releaseBudget(grant.wallet, quotedPriceUsd);
      abortIdempotency(req);
      return res.status(502).json({
        error: "Payment execution failed",
        status: output.status,
        payload: output.payload,
        grantId: grant.grantId,
        decision: policy.decision
      });
    }

    commitBudget();

    const payload = output.payload as {
      result?: QueryResult;
    };
    const result = payload.result;

    await persistSponsoredPayment({
      mode: parsed.data.mode,
      endpoint: output.endpoint,
      provider: parsed.data.provider,
      queryOrUrl: parsed.data.mode === "scrape" ? parsed.data.url! : parsed.data.query!,
      priceUsd: quotedPriceUsd,
      latencyMs: result?.latencyMs ?? 0,
      traceId: result?.traceId ?? `trace_sponsored_${grant.grantId}`,
      execution: result?.execution ?? {
        providerId: parsed.data.provider,
        source: "unavailable",
        usedFallback: true,
        fallbackReason: "missing-fallback",
        latencyEstimateMs: 0,
        observedDurationMs: 0,
        circuitBreakerState: "closed"
      },
      paymentResponseHeader: output.paymentResponseHeader,
      walletPublicKey: grant.wallet,
      sponsorshipGrantId: grant.grantId,
      policyDecision: policy.decision
    });

    completeIdempotency(req, fingerprint, 200, output.payload);
    return res.status(200).json(output.payload);
  } catch (error) {
    return next(error);
  }
});
