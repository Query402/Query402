import { describe, expect, it } from "vitest";
import {
  latencyBandSchema,
  MICRO_USD_PER_USD,
  newsQuerySchema,
  paymentChallengeSchema,
  paymentLinkAmountSchema,
  paymentLinkAssetSchema,
  paymentLinkDestinationSchema,
  paymentLinkInputSchema,
  paymentLinkNetworkSchema,
  paymentModeSchema,
  providerCategorySchema,
  providerSchema,
  query402ReceiptSchema,
  queryModeSchema,
  quoteBindErrorCodeSchema,
  receiptEvidenceKindSchema,
  receiptPaymentModeSchema,
  receiptPaymentStatusSchema,
  reliabilityBandSchema,
  requestedQuoteSchema,
  scrapeQuerySchema,
  searchQuerySchema,
  signedGrantSchema,
  slaBadgesSchema,
  sponsorshipChallengeSchema,
  sponsorshipGrantSchema
} from "./schemas.js";

const _validSlaBadge = {
  latencyBand: "fast" as const,
  reliabilityBand: "demo" as const,
  paymentMode: "demo" as const,
  badgeCopy: "Fast response · Demo provider · Demo payment"
};

const validProvider = {
  id: "search.basic",
  name: "Basic Search",
  category: "search" as const,
  priceUsd: 0.01,
  description: "Fast search",
  latencyEstimateMs: 700,
  qualityScore: 75,
  sourceType: "deterministic-fallback" as const,
  provenance: "unknown" as const,
  enabled: true
};

const validGrant = {
  grantId: "550e8400-e29b-41d4-a716-446655440000",
  wallet: `G${"A".repeat(55)}`,
  network: "stellar:testnet",
  maxAmountUsd: 1,
  expiresAt: "2026-12-31T12:00:00.000Z",
  nonce: "650e8400-e29b-41d4-a716-446655440001",
  issuedAt: "2026-06-01T12:00:00.000Z"
};

describe("queryModeSchema", () => {
  it("accepts supported query modes", () => {
    expect(queryModeSchema.parse("search")).toBe("search");
    expect(queryModeSchema.parse("news")).toBe("news");
    expect(queryModeSchema.parse("scrape")).toBe("scrape");
  });

  it("rejects unsupported modes", () => {
    expect(queryModeSchema.safeParse("chat").success).toBe(false);
  });
});

describe("providerCategorySchema", () => {
  it("matches query mode categories", () => {
    expect(providerCategorySchema.parse("search")).toBe("search");
    expect(providerCategorySchema.parse("news")).toBe("news");
    expect(providerCategorySchema.parse("scrape")).toBe("scrape");
  });
});

describe("providerSchema", () => {
  it("accepts a valid provider definition", () => {
    expect(providerSchema.parse(validProvider)).toEqual(validProvider);
  });

  it("rejects invalid category and non-positive pricing", () => {
    expect(providerSchema.safeParse({ ...validProvider, category: "chat" }).success).toBe(false);
    expect(providerSchema.safeParse({ ...validProvider, priceUsd: 0 }).success).toBe(false);
  });
});

describe("latencyBandSchema", () => {
  it("accepts valid latency bands", () => {
    expect(latencyBandSchema.parse("fast")).toBe("fast");
    expect(latencyBandSchema.parse("standard")).toBe("standard");
    expect(latencyBandSchema.parse("slow")).toBe("slow");
  });

  it("rejects invalid latency bands", () => {
    expect(latencyBandSchema.safeParse("ultra").success).toBe(false);
  });
});

describe("reliabilityBandSchema", () => {
  it("accepts valid reliability bands", () => {
    expect(reliabilityBandSchema.parse("demo")).toBe("demo");
    expect(reliabilityBandSchema.parse("fallback")).toBe("fallback");
    expect(reliabilityBandSchema.parse("live")).toBe("live");
  });

  it("rejects invalid reliability bands", () => {
    expect(reliabilityBandSchema.safeParse("unknown").success).toBe(false);
  });
});

describe("paymentModeSchema", () => {
  it("accepts valid payment modes", () => {
    expect(paymentModeSchema.parse("demo")).toBe("demo");
    expect(paymentModeSchema.parse("x402")).toBe("x402");
    expect(paymentModeSchema.parse("sponsored")).toBe("sponsored");
  });

  it("rejects invalid payment modes", () => {
    expect(paymentModeSchema.safeParse("credit").success).toBe(false);
  });
});

describe("slaBadgesSchema", () => {
  it("accepts a complete SLA badges object", () => {
    const badges = {
      latencyBand: "fast",
      latencyLabel: "Fast response",
      reliabilityBand: "live",
      reliabilityLabel: "Live results",
      paymentMode: "x402",
      paymentLabel: "Pay-per-query (x402)"
    };
    expect(slaBadgesSchema.parse(badges)).toEqual(badges);
  });

  it("rejects an SLA badges object with missing fields", () => {
    expect(slaBadgesSchema.safeParse({ latencyBand: "fast" }).success).toBe(false);
  });
});

describe("searchQuerySchema", () => {
  it("requires provider and a query of at least two characters", () => {
    expect(searchQuerySchema.parse({ provider: "search.basic", q: "stellar" })).toEqual({
      provider: "search.basic",
      q: "stellar"
    });
    expect(searchQuerySchema.safeParse({ provider: "search.basic", q: "x" }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: "stellar" }).success).toBe(false);
  });
});

describe("newsQuerySchema", () => {
  it("requires provider and a query of at least two characters", () => {
    expect(newsQuerySchema.parse({ provider: "news.fast", q: "payments" })).toEqual({
      provider: "news.fast",
      q: "payments"
    });
  });
});

describe("scrapeQuerySchema", () => {
  it("requires provider and a valid URL", () => {
    expect(
      scrapeQuerySchema.parse({ provider: "scrape.page", url: "https://example.com/page" })
    ).toEqual({ provider: "scrape.page", url: "https://example.com/page" });
    expect(scrapeQuerySchema.safeParse({ provider: "scrape.page", url: "not-a-url" }).success).toBe(
      false
    );
  });
});

describe("sponsorshipGrantSchema", () => {
  it("accepts a valid grant payload", () => {
    expect(sponsorshipGrantSchema.parse(validGrant)).toEqual(validGrant);
  });

  it("rejects invalid Stellar public keys", () => {
    expect(
      sponsorshipGrantSchema.safeParse({ ...validGrant, wallet: "invalid-wallet" }).success
    ).toBe(false);
  });
});

describe("signedGrantSchema", () => {
  it("accepts a signed grant envelope", () => {
    expect(signedGrantSchema.parse({ grant: validGrant, signature: "test-signature" })).toEqual({
      grant: validGrant,
      signature: "test-signature"
    });
  });
});

describe("sponsorshipChallengeSchema", () => {
  it("accepts a sponsorship challenge payload", () => {
    expect(
      sponsorshipChallengeSchema.parse({
        challengeId: "750e8400-e29b-41d4-a716-446655440002",
        wallet: validGrant.wallet,
        message: "Sign to request sponsorship",
        expiresAt: "2026-12-31T12:00:00.000Z"
      })
    ).toMatchObject({ message: "Sign to request sponsorship" });
  });
});

const validPaymentLinkInput = {
  amount: 50_000,
  asset: "USDC",
  destination: `G${"A".repeat(55)}`,
  network: "stellar:testnet"
};

describe("MICRO_USD_PER_USD", () => {
  it("defines one million micro-USD units per USD", () => {
    expect(MICRO_USD_PER_USD).toBe(1_000_000);
  });
});

describe("paymentLinkAmountSchema", () => {
  it("accepts a positive integer micro-USD amount", () => {
    expect(paymentLinkAmountSchema.parse(50_000)).toBe(50_000);
    expect(paymentLinkAmountSchema.parse(1)).toBe(1);
  });

  it("rejects a zero amount", () => {
    expect(paymentLinkAmountSchema.safeParse(0).success).toBe(false);
  });

  it("rejects a negative amount", () => {
    expect(paymentLinkAmountSchema.safeParse(-1).success).toBe(false);
  });

  it("rejects a non-integer amount", () => {
    expect(paymentLinkAmountSchema.safeParse(0.01).success).toBe(false);
    expect(paymentLinkAmountSchema.safeParse(50_000.5).success).toBe(false);
  });

  it("rejects a float imprecision artifact", () => {
    expect(paymentLinkAmountSchema.safeParse(0.1 + 0.2).success).toBe(false);
  });

  it("rejects non-finite numbers", () => {
    expect(paymentLinkAmountSchema.safeParse(Number.NaN).success).toBe(false);
    expect(paymentLinkAmountSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });

  it("rejects an amount beyond the safe integer range", () => {
    expect(paymentLinkAmountSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
  });
});

describe("paymentLinkAssetSchema", () => {
  it("accepts an uppercase asset code", () => {
    expect(paymentLinkAssetSchema.parse("USDC")).toBe("USDC");
  });

  it("rejects a lowercase asset code", () => {
    expect(paymentLinkAssetSchema.safeParse("usdc").success).toBe(false);
  });

  it("rejects an empty or oversized asset code", () => {
    expect(paymentLinkAssetSchema.safeParse("").success).toBe(false);
    expect(paymentLinkAssetSchema.safeParse("A".repeat(13)).success).toBe(false);
  });
});

describe("paymentLinkDestinationSchema", () => {
  it("requires a Stellar public key", () => {
    expect(paymentLinkDestinationSchema.parse(`G${"A".repeat(55)}`)).toBe(`G${"A".repeat(55)}`);
    expect(paymentLinkDestinationSchema.safeParse("not-a-destination").success).toBe(false);
    expect(paymentLinkDestinationSchema.safeParse("").success).toBe(false);
  });
});

describe("paymentLinkNetworkSchema", () => {
  it("accepts a namespaced network", () => {
    expect(paymentLinkNetworkSchema.parse("stellar:testnet")).toBe("stellar:testnet");
    expect(paymentLinkNetworkSchema.parse("stellar:pubnet")).toBe("stellar:pubnet");
  });

  it("rejects a non-namespaced network", () => {
    expect(paymentLinkNetworkSchema.safeParse("testnet").success).toBe(false);
    expect(paymentLinkNetworkSchema.safeParse("").success).toBe(false);
  });
});

describe("paymentLinkInputSchema", () => {
  it("accepts a valid payment-link input", () => {
    expect(paymentLinkInputSchema.parse(validPaymentLinkInput)).toEqual(validPaymentLinkInput);
  });

  it("rejects when any field is missing", () => {
    for (const field of ["amount", "asset", "destination", "network"] as const) {
      const { [field]: _omitted, ...rest } = validPaymentLinkInput;
      expect(paymentLinkInputSchema.safeParse(rest).success).toBe(false);
    }
  });
});

describe("receiptPaymentModeSchema", () => {
  it("accepts the supported payment modes", () => {
    expect(receiptPaymentModeSchema.parse("wallet")).toBe("wallet");
    expect(receiptPaymentModeSchema.parse("sponsored")).toBe("sponsored");
    expect(receiptPaymentModeSchema.parse("demo")).toBe("demo");
  });

  it("rejects unknown payment modes", () => {
    expect(receiptPaymentModeSchema.safeParse("invoice").success).toBe(false);
  });
});

describe("receiptPaymentStatusSchema", () => {
  it("accepts the supported payment statuses", () => {
    expect(receiptPaymentStatusSchema.parse("settled")).toBe("settled");
    expect(receiptPaymentStatusSchema.parse("demo-paid")).toBe("demo-paid");
    expect(receiptPaymentStatusSchema.parse("verified")).toBe("verified");
    expect(receiptPaymentStatusSchema.parse("failed")).toBe("failed");
  });

  it("rejects the internal-only settlement-pending state", () => {
    // The builder normalizes "settlement-pending" to `null` before exporting a
    // public receipt, so the public schema deliberately omits it.
    expect(receiptPaymentStatusSchema.safeParse("settlement-pending").success).toBe(false);
  });

  it("rejects unrelated statuses", () => {
    expect(receiptPaymentStatusSchema.safeParse("not_available").success).toBe(false);
  });
});

describe("receiptEvidenceKindSchema", () => {
  it("accepts the supported evidence kinds", () => {
    expect(receiptEvidenceKindSchema.parse("demo")).toBe("demo");
    expect(receiptEvidenceKindSchema.parse("settled")).toBe("settled");
    expect(receiptEvidenceKindSchema.parse("verified")).toBe("verified");
    expect(receiptEvidenceKindSchema.parse("failed")).toBe("failed");
  });
});

describe("query402ReceiptSchema", () => {
  const baseReceipt = {
    schema: "query402.receipt.v1" as const,
    generatedAt: "2026-06-30T12:00:00.000Z",
    mode: "search" as const,
    providerId: "search.basic",
    providerName: "Basic Search",
    quotedPriceUsd: 0.01,
    traceId: "trace_123",
    resultTimestamp: "2026-06-30T12:00:00.000Z",
    payment: {
      mode: "wallet" as const,
      status: "settled" as const,
      evidenceKind: "settled" as const,
      transactionHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      network: "stellar:testnet"
    }
  };

  it("accepts a canonical settled wallet receipt", () => {
    expect(query402ReceiptSchema.parse(baseReceipt)).toEqual(baseReceipt);
  });

  it("accepts a sponsored receipt with null transaction hash", () => {
    const sponsored = {
      ...baseReceipt,
      mode: "news" as const,
      payment: {
        mode: "sponsored" as const,
        status: "demo-paid" as const,
        evidenceKind: "demo" as const,
        transactionHash: null,
        network: "stellar:testnet"
      }
    };
    expect(query402ReceiptSchema.parse(sponsored)).toEqual(sponsored);
  });

  it("accepts missing payment status fields as null", () => {
    const partial = {
      ...baseReceipt,
      payment: {
        mode: "demo" as const,
        status: null,
        evidenceKind: null,
        transactionHash: null,
        network: null
      }
    };
    expect(query402ReceiptSchema.parse(partial)).toEqual(partial);
  });

  it("rejects receipts with a different schema version", () => {
    expect(
      query402ReceiptSchema.safeParse({ ...baseReceipt, schema: "query402.receipt.v2" }).success
    ).toBe(false);
  });

  it("rejects receipts with an unsupported payment mode", () => {
    expect(
      query402ReceiptSchema.safeParse({
        ...baseReceipt,
        payment: { ...baseReceipt.payment, mode: "stripe" }
      }).success
    ).toBe(false);
  });

  it("rejects receipts missing the schema literal", () => {
    const { schema: _ignored, ...withoutSchema } = baseReceipt;
    expect(query402ReceiptSchema.safeParse(withoutSchema).success).toBe(false);
  });
});

describe("requestedQuoteSchema / paymentChallengeSchema", () => {
  const quote = {
    provider: "search.basic",
    amount: "100000",
    asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    network: "stellar:testnet"
  };

  it("accepts a requested quote", () => {
    expect(requestedQuoteSchema.parse(quote)).toEqual(quote);
  });

  it("accepts a challenge with optional expiry", () => {
    expect(
      paymentChallengeSchema.parse({
        ...quote,
        expiresAt: "2099-01-01T00:00:00.000Z"
      })
    ).toMatchObject({ expiresAt: "2099-01-01T00:00:00.000Z" });
  });

  it("rejects incomplete quotes", () => {
    expect(requestedQuoteSchema.safeParse({ ...quote, amount: "" }).success).toBe(false);
  });
});

describe("quoteBindErrorCodeSchema", () => {
  it("accepts the supported bind error codes", () => {
    expect(quoteBindErrorCodeSchema.parse("challenge_mismatch")).toBe("challenge_mismatch");
    expect(quoteBindErrorCodeSchema.parse("challenge_expired")).toBe("challenge_expired");
    expect(quoteBindErrorCodeSchema.parse("challenge_empty")).toBe("challenge_empty");
  });
});
