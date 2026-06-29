import { Router, type Response } from "express";
import { queryModeSchema, stellarPublicKeySchema } from "@query402/shared";
import { z } from "zod";
import { config } from "../lib/config.js";
import { createChallenge, verifyAndConsumeChallenge } from "../lib/sponsorship/challenge.js";
import { issueGrant } from "../lib/sponsorship/grant.js";
import { previewSponsoredRun } from "../lib/sponsorship/policy.js";

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

    const verification = verifyAndConsumeChallenge(parsed.data);
    if (!verification.ok) {
      return res.status(403).json({ error: verification.error });
    }

    const signedGrant = issueGrant(parsed.data.wallet);
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
