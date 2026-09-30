import { Router, type Request, type Response } from "express";
import { queryModeSchema, stellarPublicKeySchema } from "@query402/shared";
import { z } from "zod";
import { config } from "../lib/config.js";
import { createChallenge, verifyAndConsumeChallenge } from "../lib/sponsorship/challenge.js";
import { issueGrant } from "../lib/sponsorship/grant.js";
import {
  beginSponsorshipIdempotency,
  completeSponsorshipIdempotency,
  abortSponsorshipIdempotency,
  type SponsorshipIdempotencyInput
} from "../lib/sponsorship/idempotency.js";
import { previewSponsoredRun } from "../lib/sponsorship/policy.js";
import { isIdempotencyStorageAvailable } from "../lib/idempotency/service.js";

const challengeRequestSchema = z.object({
  wallet: stellarPublicKeySchema
});

const grantRequestSchema = z.object({
  wallet: stellarPublicKeySchema,
  challengeId: z.string().uuid(),
  signature: z.string().min(1)
});

const previewRequestSchema = z.object({
  wallet: stellarPublicKeySchema,
  mode: queryModeSchema,
  provider: z.string().min(1)
});

export const sponsorshipRouter = Router();

function sponsorshipDisabled(res: Response) {
  return res.status(503).json({ error: "sponsorship_disabled" });
}

function signingNotConfigured(res: Response) {
  return res.status(503).json({ error: "sponsorship_signing_not_configured" });
}

function readSponsorshipIdempotencyKey(req: Request): string | undefined {
  const key = req.get("Idempotency-Key")?.trim();
  return key ? key : undefined;
}

sponsorshipRouter.post("/api/sponsorship/challenge", (req, res) => {
  if (!config.sponsorshipEnabled) {
    return sponsorshipDisabled(res);
  }

  const parsed = challengeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const challenge = createChallenge(parsed.data.wallet);
  return res.status(200).json(challenge);
});

sponsorshipRouter.post("/api/sponsorship/grants", (req, res, next) => {
  try {
    if (!config.sponsorshipEnabled) {
      return sponsorshipDisabled(res);
    }

    if (!config.SPONSORSHIP_SIGNING_SECRET) {
      return signingNotConfigured(res);
    }

    const parsed = grantRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    // Idempotent issuance: a repeated Idempotency-Key returns the ORIGINAL
    // grant instead of minting (and later debiting) a second one. The replay
    // hash binds the key to the payer wallet so a key cannot be reused across
    // wallets, and challenge consumption below is still one-shot.
    const idempotencyKey = readSponsorshipIdempotencyKey(req);
    let idempotencyInput: SponsorshipIdempotencyInput | undefined;
    if (idempotencyKey) {
      if (!isIdempotencyStorageAvailable()) {
        return res.status(503).json({ error: "idempotency_storage_unavailable" });
      }

      idempotencyInput = {
        key: idempotencyKey,
        wallet: parsed.data.wallet,
        amountUsd: config.SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD
      };

      const gate = beginSponsorshipIdempotency(idempotencyInput);
      if (gate.action === "replay") {
        return res.status(200).json(gate.signedGrant);
      }
      if (gate.action === "conflict") {
        return res.status(409).json({ error: "idempotency_key_conflict" });
      }
      if (gate.action === "in_progress") {
        return res.status(409).json({ error: "idempotency_in_progress" });
      }
    }

    const verification = verifyAndConsumeChallenge(parsed.data);
    if (!verification.ok) {
      if (idempotencyInput) {
        abortSponsorshipIdempotency(idempotencyInput);
      }
      return res.status(403).json({ error: verification.error });
    }

    const signedGrant = issueGrant(parsed.data.wallet);

    if (idempotencyInput) {
      try {
        completeSponsorshipIdempotency(idempotencyInput, signedGrant);
      } catch (cacheError) {
        // Never fail an already-issued grant because the replay cache write
        // failed; the grant signature remains valid either way.
        console.warn("sponsorship idempotency cache write failed", cacheError);
      }
    }

    return res.status(200).json(signedGrant);
  } catch (error) {
    return next(error);
  }
});

sponsorshipRouter.post("/api/sponsorship/preview", (req, res) => {
  const parsed = previewRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const preview = previewSponsoredRun(parsed.data);
  return res.status(200).json(preview);
});
