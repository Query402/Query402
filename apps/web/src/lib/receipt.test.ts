import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { query402ReceiptSchema } from "@query402/shared";
import { isPaymentProofFresh } from "@query402/shared";
import type { PaidQueryResponse, PublicPaymentEvidence } from "../types.js";
import { buildReceipt, receiptFilename, serializeReceipt, evaluatePaymentEvidenceGate, validateReceipt } from "./receipt.js";
import { isReceiptFresh } from "./freshness.js";

function settledEvidence(overrides: Partial<PublicPaymentEvidence> = {}): PublicPaymentEvidence {
  return {
    kind: "settled",
    status: "settled",
    network: "stellar:testnet",
    asset: "USDC",
    amount: "100000",
    payTo: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    facilitatorUrl: "https://facilitator.example",
    transactionHash:
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    ...overrides
  };
}

function settledResponse(overrides: Partial<PaidQueryResponse> = {}): PaidQueryResponse {
  return {
    payment: {
      network: "stellar:testnet",
      facilitatorUrl: "https://facilitator.example",
      evidence: settledEvidence()
    },
    result: {
      mode: "search",
      providerId: "search.basic",
      providerName: "Basic Search",
      priceUsd: 0.01,
      latencyMs: 250,
      timestamp: "2026-06-30T12:00:00.000Z",
      traceId: "trace_123",
      items: [{ title: "t", url: "https://example.com", snippet: "s", score: 1 }],
      source: "deterministic-fallback"
    },
    ...overrides
  };
}

const FIXED_DATE = new Date("2026-06-30T12:34:56.000Z");
const FIXED_CLOCK = () => FIXED_DATE;
const MAX_AGE_MS = 5 * 60 * 1000;

describe("buildReceipt", () => {
  test("captures all required fields from a settled wallet response", () => {
    const receipt = buildReceipt({
      response: settledResponse(),
      userPaymentMode: "wallet",
      generatedAt: FIXED_DATE
    });

    query402ReceiptSchema.parse(receipt);

    assert.equal(receipt.schema, "query402.receipt.v1");
    assert.equal(receipt.generatedAt, FIXED_DATE.toISOString());
    assert.equal(receipt.mode, "search");
    assert.equal(receipt.providerId, "search.basic");
    assert.equal(receipt.providerName, "Basic Search");
    assert.equal(receipt.quotedPriceUsd, 0.01);
    assert.equal(receipt.traceId, "trace_123");
    assert.equal(receipt.resultTimestamp, "2026-06-30T12:00:00.000Z");
    assert.equal(receipt.payment.mode, "wallet");
    assert.equal(receipt.payment.status, "settled");
    assert.equal(receipt.payment.evidenceKind, "settled");
    assert.equal(receipt.payment.network, "stellar:testnet");
  });

  test("infers demo mode when the API stamps evidence.kind === demo", () => {
    const receipt = buildReceipt({
      response: settledResponse({
        payment: {
          network: "stellar:testnet",
          facilitatorUrl: "https://facilitator.example",
          evidence: {
            kind: "demo",
            status: "demo-paid",
            network: "stellar:testnet"
          }
        }
      }),
      userPaymentMode: "sponsored",
      generatedAt: FIXED_DATE
    });

    // Demo evidence wins over the user-selected sponsored toggle.
    assert.equal(receipt.payment.mode, "demo");
    assert.equal(receipt.payment.evidenceKind, "demo");
    assert.equal(receipt.payment.status, "demo-paid");
    assert.equal(receipt.payment.transactionHash, null);
    assert.equal(receipt.payment.network, "stellar:testnet");
  });

  test("renders missing payment fields as null", () => {
    const receipt = buildReceipt({
      response: settledResponse({
        payment: {
          network: "stellar:testnet",
          facilitatorUrl: "https://facilitator.example",
          evidence: settledEvidence({
            kind: "verified",
            status: "verified",
            transactionHash: undefined
          })
        }
      }),
      userPaymentMode: "wallet",
      generatedAt: FIXED_DATE
    });

    assert.equal(receipt.payment.transactionHash, null);
    assert.equal(receipt.payment.evidenceKind, "verified");
    assert.equal(receipt.payment.status, "verified");
  });

  test("falls back from bare {kind, status} evidence to top-level payment.network", () => {
    // Simulates the API's pre-settlement fallback shape where evidence only
    // carries { kind: "verified", status: "settlement-pending" } and the other
    // fields are populated on the outer payment envelope.
    const receipt = buildReceipt({
      response: settledResponse({
        payment: {
          network: "stellar:testnet",
          facilitatorUrl: "https://facilitator.example",
          evidence: { kind: "verified", status: "settlement-pending", network: "stellar:testnet" }
        }
      }),
      userPaymentMode: "wallet",
      generatedAt: FIXED_DATE
    });

    query402ReceiptSchema.parse(receipt);

    // settlement-pending is an internal-only value; the public schema drops it.
    assert.equal(receipt.payment.status, null);
    assert.equal(receipt.payment.evidenceKind, "verified");
    assert.equal(receipt.payment.transactionHash, null);
    assert.equal(receipt.payment.network, "stellar:testnet");
  });

  test("does not embed any secret fields (payment header, signatures, grant)", () => {
    const receipt = buildReceipt({
      response: settledResponse(),
      userPaymentMode: "wallet",
      generatedAt: FIXED_DATE
    });
    const json = serializeReceipt(receipt);

    assert.equal(json.includes("paymentResponseHeader"), false, "must not include paymentResponseHeader");
    assert.equal(json.includes("facilitatorResult"), false, "must not include facilitatorResult");
    assert.equal(json.includes("X-Sponsorship-Grant"), false, "must not include sponsorship grant header");
    assert.equal(json.includes("Bearer "), false, "must not include facilitator auth header");
    assert.equal(json.includes("BEGIN"), false, "must not include any PEM/private key material");
    assert.equal(json.includes("payer"), false, "must not include payer wallet (public-key leak)");
    assert.equal(json.includes("authEntry"), false, "must not include signed Soroban auth entries");
  });

  test("schema version literal survives round-trip via zod", () => {
    const receipt = buildReceipt({
      response: settledResponse(),
      userPaymentMode: "wallet",
      generatedAt: FIXED_DATE
    });

    const parsed = query402ReceiptSchema.parse(receipt);
    assert.deepEqual(parsed, receipt);
  });

  test("defensively normalizes a response with missing payment envelope", () => {
    // Belt-and-suspenders: the runtime response shape can never actually be
    // missing payment, but buildReceipt must still return a parseable receipt
    // (rather than throw) so the UI never crashes when a reviewer clicks
    // Export against a stale state.
    const response: PaidQueryResponse = {
      payment: undefined as unknown as PaidQueryResponse["payment"],
      result: settledResponse().result
    };

    const receipt = buildReceipt({
      response,
      userPaymentMode: "wallet",
      generatedAt: FIXED_DATE
    });

    query402ReceiptSchema.parse(receipt);
    assert.equal(receipt.payment.status, null);
    assert.equal(receipt.payment.transactionHash, null);
    assert.equal(receipt.payment.network, null);
  });
});

describe("payment proof freshness", () => {
  test("a fresh proof is accepted by the shared helper and shown as paid", () => {
    const response = settledResponse();
    const proofTimestamp = "2026-06-30T12:34:00.000Z";

    assert.equal(
      isPaymentProofFresh({
        proofTimestamp,
        now: FIXED_CLOCK,
        maxAgeMs: MAX_AGE_MS
      }),
      true
    );
    assert.equal(
      isReceiptFresh({
        proofTimestamp,
        now: FIXED_CLOCK,
        maxAgeMs: MAX_AGE_MS
      }),
      true
    );
    assert.equal(response.payment.evidence.status, "settled");
  });

  test("a proof at the exact boundary is rejected by both the shared helper and the web client", () => {
    const boundaryTimestamp = new Date(FIXED_DATE.getTime() - MAX_AGE_MS).toISOString();

    assert.equal(
      isPaymentProofFresh({
        proofTimestamp: boundaryTimestamp,
        now: FIXED_CLOCK,
        maxAgeMs: MAX_AGE_MS
      }),
      false
    );
    assert.equal(
      isReceiptFresh({
        proofTimestamp: boundaryTimestamp,
        now: FIXED_CLOCK,
        maxAgeMs: MAX_AGE_MS
      }),
      false
    );
  });

  test("an expired proof is not shown as paid on the web fixture", () => {
    const expiredTimestamp = new Date(FIXED_DATE.getTime() - MAX_AGE_MS - 1).toISOString();

    assert.equal(
      isReceiptFresh({
        proofTimestamp: expiredTimestamp,
        now: FIXED_CLOCK,
        maxAgeMs: MAX_AGE_MS
      }),
      false
    );
  });
});

describe("receiptFilename", () => {
  test("produces a stable, slugged filename", () => {
    const receipt = buildReceipt({
      response: settledResponse(),
      userPaymentMode: "wallet",
      generatedAt: FIXED_DATE
    });
    const filename = receiptFilename(receipt, FIXED_DATE);

    assert.match(filename, /^query402-receipt-search-search\.basic-2026-06-30T12-34-56-000Z\.json$/);
  });
});

describe("validateReceipt + evaluatePaymentEvidenceGate", () => {
  const now = Date.parse("2026-06-30T12:34:56.000Z");

  test("accepts a fresh built receipt", () => {
    const receipt = buildReceipt({
      response: settledResponse(),
      userPaymentMode: "wallet",
      generatedAt: FIXED_DATE
    });

    assert.deepEqual(validateReceipt(receipt), receipt);
    const gate = evaluatePaymentEvidenceGate(receipt, now);
    assert.equal(gate.show, true);
    assert.equal(gate.reason, "ok");
  });

  test("rejects an invalid receipt", () => {
    assert.equal(validateReceipt({ schema: "nope" }), null);
    const gate = evaluatePaymentEvidenceGate({ schema: "nope" }, now);
    assert.equal(gate.show, false);
    assert.equal(gate.reason, "invalid_receipt");
  });

  test("rejects a stale receipt with a fake clock", () => {
    const receipt = buildReceipt({
      response: settledResponse({
        result: {
          ...settledResponse().result,
          timestamp: "2026-06-30T10:00:00.000Z"
        }
      }),
      userPaymentMode: "wallet",
      generatedAt: new Date("2026-06-30T10:00:00.000Z")
    });

    const gate = evaluatePaymentEvidenceGate(receipt, now);
    assert.equal(gate.show, false);
    assert.equal(gate.reason, "stale_receipt");
  });
});
