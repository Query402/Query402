import { describe, it, expect } from "vitest";
import { getPaymentEvidenceInfo } from "./PaymentEvidenceBanner.js";
import type { PaidQueryResponse } from "../types.js";

describe("PaymentEvidenceBanner - getPaymentEvidenceInfo helper", () => {
  it("handles missing (undefined) payment evidence", () => {
    const info = getPaymentEvidenceInfo(undefined, "stellar:testnet");

    expect(info.status).toBe("missing");
    expect(info.title).toMatch(/Missing Payment Evidence/i);
    expect(info.className).toMatch(/--missing/);
    expect(info.explorerUrl).toBeUndefined();
  });

  it("handles demo-mode payment evidence", () => {
    const evidence: PaidQueryResponse["payment"]["evidence"] = {
      kind: "demo",
      status: "demo-paid",
      network: "stellar:testnet",
      payTo: "GBX...",
      facilitatorUrl: "http://localhost:3001",
      payer: "demo-agent"
    };

    const info = getPaymentEvidenceInfo(evidence, "stellar:testnet");

    expect(info.status).toBe("demo");
    expect(info.title).toMatch(/Demo Mode Payment/i);
    expect(info.className).toMatch(/--demo/);
    expect(info.description).toMatch(/demo-agent/);
    expect(info.explorerUrl).toBeUndefined();
  });

  it("handles failed payment evidence", () => {
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

    expect(info.status).toBe("failed");
    expect(info.title).toMatch(/Payment Verification Failed/i);
    expect(info.className).toMatch(/--failed/);
    expect(info.description).toMatch(/insufficient funds/);
    expect(info.explorerUrl).toBeUndefined();
  });

  it("handles verified (challenge authorized, settlement pending) evidence on testnet", () => {
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

    expect(info.status).toBe("verified");
    expect(info.title).toMatch(/Payment Verified/i);
    expect(info.className).toMatch(/--verified/);
    expect(info.description).toMatch(/G_SPONSOR/);
    expect(info.description).toMatch(/USDC/);
    expect(info.explorerUrl).toBeUndefined(); // No Tx hash yet
  });

  it("handles settled payment evidence with explorer link on testnet", () => {
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

    expect(info.status).toBe("verified");
    expect(info.title).toMatch(/Payment Settled/i);
    expect(info.className).toMatch(/--verified/);
    expect(info.description).toMatch(/0.02 USDC/);
    expect(info.explorerUrl).toBe("https://stellar.expert/explorer/testnet/tx/abcd1234hash");
  });

  it("handles settled payment evidence with explorer link on mainnet", () => {
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

    expect(info.status).toBe("verified");
    expect(info.explorerUrl).toBe("https://stellar.expert/explorer/public/tx/abcd5678hash");
  });
});
