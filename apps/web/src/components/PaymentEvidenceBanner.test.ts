import { test, describe } from "node:test";
import assert from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import PaymentEvidenceBanner, { getPaymentEvidenceInfo } from "./PaymentEvidenceBanner.js";
import type { PaidQueryResponse } from "../types.js";
import { buildReceipt } from "../lib/receipt.js";
import type { Query402Receipt } from "@query402/shared";

const NOW = Date.parse("2026-06-30T12:05:00.000Z");

function settledPayment(): PaidQueryResponse["payment"] {
  return {
    network: "stellar:testnet",
    facilitatorUrl: "https://facilitator.example",
    evidence: {
      kind: "settled",
      status: "settled",
      network: "stellar:testnet",
      payTo: "GBX...",
      facilitatorUrl: "https://facilitator.example",
      payer: "G_PAYER",
      amount: "0.02",
      asset: "USDC",
      transactionHash: "abcd1234hash"
    }
  };
}

function freshReceipt(overrides: Partial<Query402Receipt> = {}): Query402Receipt {
  return {
    schema: "query402.receipt.v1",
    generatedAt: "2026-06-30T12:04:00.000Z",
    mode: "search",
    providerId: "search.basic",
    providerName: "Basic Search",
    quotedPriceUsd: 0.01,
    traceId: "trace_1",
    resultTimestamp: "2026-06-30T12:04:00.000Z",
    payment: {
      mode: "wallet",
      status: "settled",
      evidenceKind: "settled",
      transactionHash: "abcd1234hash",
      network: "stellar:testnet"
    },
    ...overrides
  };
}

describe("PaymentEvidenceBanner - getPaymentEvidenceInfo helper", () => {
  test("handles missing (undefined) payment evidence", () => {
    const info = getPaymentEvidenceInfo(undefined, "stellar:testnet");

    assert.strictEqual(info.status, "missing");
    assert.match(info.title, /Missing Payment Evidence/i);
    assert.match(info.className, /--missing/);
    assert.strictEqual(info.explorerUrl, undefined);
  });

  test("handles demo-mode payment evidence", () => {
    const evidence: PaidQueryResponse["payment"]["evidence"] = {
      kind: "demo",
      status: "demo-paid",
      network: "stellar:testnet",
      payTo: "GBX...",
      facilitatorUrl: "http://localhost:3001",
      payer: "demo-agent"
    };

    const info = getPaymentEvidenceInfo(evidence, "stellar:testnet");

    assert.strictEqual(info.status, "demo");
    assert.match(info.title, /Demo Mode Payment/i);
    assert.match(info.className, /--demo/);
    assert.match(info.description, /demo-agent/);
    assert.strictEqual(info.explorerUrl, undefined);
  });

  test("handles failed payment evidence", () => {
    const evidence: PaidQueryResponse["payment"]["evidence"] = {
      kind: "failed",
      status: "failed",
      network: "stellar:testnet",
      payTo: "GBX...",
      facilitatorUrl: "http://localhost:3001",
      payer: "demo-agent",
      error: "insufficient funds"
    };

    const info = getPaymentEvidenceInfo(evidence, "stellar:testnet");

    assert.strictEqual(info.status, "failed");
    assert.match(info.title, /Payment Verification Failed/i);
    assert.match(info.className, /--failed/);
    assert.match(info.description, /insufficient funds/);
    assert.strictEqual(info.explorerUrl, undefined);
  });

  test("handles verified (challenge authorized, settlement pending) evidence on testnet", () => {
    const evidence: PaidQueryResponse["payment"]["evidence"] = {
      kind: "verified",
      status: "verified",
      network: "Test SDF Network ; September 2015",
      payTo: "GBX...",
      facilitatorUrl: "http://localhost:3001",
      payer: "G_SPONSOR",
      amount: "0.01",
      asset: "USDC"
    };

    const info = getPaymentEvidenceInfo(evidence);

    assert.strictEqual(info.status, "verified");
    assert.match(info.title, /Payment Verified/i);
    assert.match(info.className, /--verified/);
    assert.match(info.description, /G_SPONSOR/);
    assert.match(info.description, /USDC/);
    assert.strictEqual(info.explorerUrl, undefined);
  });

  test("handles settled payment evidence with explorer link on testnet", () => {
    const evidence: PaidQueryResponse["payment"]["evidence"] = {
      kind: "settled",
      status: "settled",
      network: "stellar:testnet",
      payTo: "GBX...",
      facilitatorUrl: "http://localhost:3001",
      payer: "G_PAYER",
      amount: "0.02",
      asset: "USDC",
      transactionHash: "abcd1234hash"
    };

    const info = getPaymentEvidenceInfo(evidence);

    assert.strictEqual(info.status, "verified");
    assert.match(info.title, /Payment Settled/i);
    assert.match(info.className, /--verified/);
    assert.match(info.description, /0.02 USDC/);
    assert.strictEqual(info.explorerUrl, "https://stellar.expert/explorer/testnet/tx/abcd1234hash");
  });

  test("handles settled payment evidence with explorer link on mainnet", () => {
    const evidence: PaidQueryResponse["payment"]["evidence"] = {
      kind: "settled",
      status: "settled",
      network: "stellar:pubnet",
      payTo: "GBX...",
      facilitatorUrl: "http://localhost:3001",
      payer: "G_PAYER",
      amount: "0.02",
      asset: "USDC",
      transactionHash: "abcd5678hash"
    };

    const info = getPaymentEvidenceInfo(evidence);

    assert.strictEqual(info.status, "verified");
    assert.strictEqual(info.explorerUrl, "https://stellar.expert/explorer/public/tx/abcd5678hash");
  });
});

describe("PaymentEvidenceBanner - receipt + freshness gate", () => {
  test("renders the banner for a fresh valid receipt (fake clock)", () => {
    const html = renderToStaticMarkup(
      React.createElement(PaymentEvidenceBanner, {
        payment: settledPayment(),
        receipt: freshReceipt(),
        now: NOW
      })
    );

    assert.match(html, /payment-evidence-banner/);
    assert.match(html, /Payment Settled/);
    assert.doesNotMatch(html, /payment-signature|payment-response|x-payment/i);
  });

  test("hides the banner when the receipt is expired", () => {
    const html = renderToStaticMarkup(
      React.createElement(PaymentEvidenceBanner, {
        payment: settledPayment(),
        receipt: freshReceipt({
          generatedAt: "2026-06-30T11:00:00.000Z",
          resultTimestamp: "2026-06-30T11:00:00.000Z"
        }),
        now: NOW
      })
    );

    assert.strictEqual(html, "");
  });

  test("hides the banner when the receipt is invalid", () => {
    const html = renderToStaticMarkup(
      React.createElement(PaymentEvidenceBanner, {
        payment: settledPayment(),
        receipt: { schema: "nope" } as unknown as Query402Receipt,
        now: NOW
      })
    );

    assert.strictEqual(html, "");
  });

  test("hides the banner when no receipt is supplied", () => {
    const html = renderToStaticMarkup(
      React.createElement(PaymentEvidenceBanner, {
        payment: settledPayment(),
        receipt: null,
        now: NOW
      })
    );

    assert.strictEqual(html, "");
  });

  test("buildReceipt output still gates through validate + freshness", () => {
    const receipt = buildReceipt({
      response: {
        payment: settledPayment(),
        result: {
          mode: "search",
          providerId: "search.basic",
          providerName: "Basic Search",
          priceUsd: 0.01,
          latencyMs: 10,
          timestamp: "2026-06-30T12:04:00.000Z",
          traceId: "trace_1",
          items: [],
          source: "deterministic-fallback"
        }
      },
      userPaymentMode: "wallet",
      generatedAt: new Date("2026-06-30T12:04:00.000Z")
    });

    const html = renderToStaticMarkup(
      React.createElement(PaymentEvidenceBanner, {
        payment: settledPayment(),
        receipt,
        now: NOW
      })
    );

    assert.match(html, /Payment Settled/);
  });
});
