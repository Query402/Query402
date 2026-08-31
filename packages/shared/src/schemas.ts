import { z } from "zod";

export const queryModeSchema = z.enum(["search", "news", "scrape"]);

export const providerCategorySchema = queryModeSchema;

export const provenanceSchema = z.enum(["mock", "fallback", "live", "unknown"]);

export const providerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: providerCategorySchema,
  priceUsd: z.number().positive(),
  description: z.string().min(1),
  latencyEstimateMs: z.number().int().positive(),
  qualityScore: z.number().min(1).max(100),
  sourceType: z.enum(["live", "deterministic-fallback", "unavailable"]),
  provenance: provenanceSchema,
  enabled: z.boolean()
});

export const baseQuerySchema = z.object({
  provider: z.string().min(1)
});

export const searchQuerySchema = baseQuerySchema.extend({
  q: z.string().min(2)
});

export const newsQuerySchema = baseQuerySchema.extend({
  q: z.string().min(2)
});

export const scrapeQuerySchema = baseQuerySchema.extend({
  url: z.string().url()
});

export const providerCapabilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: providerCategorySchema,
  priceUsd: z.number().positive(),
  sourceType: z.enum(["live", "deterministic-fallback", "unavailable"]),
  latencyEstimateMs: z.number().int().positive(),
  enabled: z.boolean(),
  hasFallback: z.boolean(),
  caveat: z.string().nullable()
});

const stellarPublicKeySchema = z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar public key");

export { stellarPublicKeySchema };

export const sponsorshipGrantSchema = z.object({
  grantId: z.string().uuid(),
  wallet: stellarPublicKeySchema,
  network: z.string().min(1),
  mode: queryModeSchema.optional(),
  providerId: z.string().min(1).optional(),
  maxAmountUsd: z.number().positive(),
  expiresAt: z.string().datetime({ offset: true }),
  nonce: z.string().uuid(),
  issuedAt: z.string().datetime({ offset: true })
});

export const signedGrantSchema = z.object({
  grant: sponsorshipGrantSchema,
  signature: z.string().min(1)
});

export const sponsorshipChallengeSchema = z.object({
  challengeId: z.string().uuid(),
  wallet: stellarPublicKeySchema,
  message: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true })
});

export const sponsorshipPreviewRequestSchema = z.object({
  wallet: stellarPublicKeySchema,
  mode: queryModeSchema,
  provider: z.string().min(1)
});

// IMPORTANT: This schema intentionally omits signature and nonce.
// The preview endpoint MUST NOT surface a fully signed grant,
// otherwise it would bypass the SEP-53 challenge/signature flow.
export const demoScenarioSchema = z.object({
  id: z.string().min(1),
  mode: queryModeSchema,
  recommendedProvider: z.string().min(1),
  sampleQuery: z.string().min(1),
  expectedEvidenceFields: z.array(z.string().min(1)).nonempty(),
  worksInDemoMode: z.boolean(),
  worksInRealMode: z.boolean()
});

export const demoScenarioManifestSchema = z.object({
  scenarios: z.array(demoScenarioSchema)
});

export const sponsorshipPreviewResponseSchema = z.object({
  sponsorshipEnabled: z.boolean(),
  storageAvailable: z.boolean(),
  available: z.boolean(),
  decision: z.string().min(1),
  network: z.string().min(1),
  wallet: stellarPublicKeySchema,
  mode: queryModeSchema,
  provider: z.string().min(1),
  providerName: z.string().min(1),
  grant: z.object({
    maxAmountUsd: z.number().positive(),
    ttlSeconds: z.number().int().positive(),
    expiresInSeconds: z.number().int().nonnegative(),
    restrictions: z.object({
      mode: queryModeSchema.nullable(),
      providerId: z.string().nullable()
    })
  }),
  quotedPriceUsd: z.number().positive(),
  priceFitsGrant: z.boolean(),
  perWalletBudget: z.object({
    limitUsd: z.number().positive(),
    spentUsd: z.number().nonnegative(),
    remainingUsd: z.number().nonnegative(),
    windowStart: z.string().min(1)
  }),
  globalBudget: z.object({
    limitUsd: z.number().positive(),
    spentUsd: z.number().nonnegative(),
    remainingUsd: z.number().nonnegative(),
    windowStart: z.string().min(1)
  }),
  reason: z.string().optional()
});

// --- Receipt export schemas ---------------------------------------------------
//
// These schemas describe the public-safe payload that the web client writes to a
// JSON file when a reviewer clicks "Export receipt". No secrets, payment
// headers, facilitator responses, or wallet secrets are included. Missing
// fields intentionally render as `null` rather than `"not_available"` so the
// output stays trivially diff-able in pull requests and posts.

export const receiptPaymentModeSchema = z.enum(["wallet", "sponsored", "demo"]);

export const receiptPaymentStatusSchema = z.enum([
  "verified",
  "settled",
  "failed",
  "demo-paid"
]);

export const receiptEvidenceKindSchema = z.enum(["demo", "verified", "settled", "failed"]);

export const query402ReceiptSchema = z.object({
  schema: z.literal("query402.receipt.v1"),
  generatedAt: z.string().datetime({ offset: true }),
  mode: queryModeSchema,
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  quotedPriceUsd: z.number().nonnegative(),
  traceId: z.string().min(1),
  resultTimestamp: z.string().datetime({ offset: true }),
  payment: z.object({
    mode: receiptPaymentModeSchema,
    status: receiptPaymentStatusSchema.nullable(),
    evidenceKind: receiptEvidenceKindSchema.nullable(),
    transactionHash: z.string().nullable(),
    network: z.string().nullable()
  })
});

export type Query402Receipt = z.infer<typeof query402ReceiptSchema>;
