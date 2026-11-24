import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  appendReceiptToTranscript,
  formatReceiptTranscriptLine,
  paymentReferenceOf,
  TranscriptValidationError,
  validateReceiptForTranscript
} from "./transcript.js";
import type { Query402Receipt } from "@query402/shared";

const baseReceipt: Query402Receipt = {
  schema: "query402.receipt.v1",
  generatedAt: "2026-06-30T12:00:00.000Z",
  mode: "search",
  providerId: "search.basic",
  providerName: "Basic Search",
  quotedPriceUsd: 0.01,
  traceId: "trace_123",
  resultTimestamp: "2026-06-30T12:00:00.000Z",
  payment: {
    mode: "wallet",
    status: "settled",
    evidenceKind: "settled",
    transactionHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    network: "stellar:testnet"
  }
};

function tempTranscriptPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "query402-transcript-")),
    "agent-receipts.jsonl"
  );
}

describe("validateReceiptForTranscript", () => {
  it("accepts a schema-valid receipt for the expected provider", () => {
    const parsed = validateReceiptForTranscript(baseReceipt, "search.basic");
    expect(parsed).toEqual(baseReceipt);
    expect(paymentReferenceOf(parsed)).toBe(baseReceipt.payment.transactionHash);
  });

  it("rejects an unknown schema version", () => {
    expect(() =>
      validateReceiptForTranscript(
        { ...baseReceipt, schema: "query402.receipt.v2" },
        "search.basic"
      )
    ).toThrow(TranscriptValidationError);

    try {
      validateReceiptForTranscript(
        { ...baseReceipt, schema: "query402.receipt.v2" },
        "search.basic"
      );
    } catch (err) {
      expect(err).toBeInstanceOf(TranscriptValidationError);
      expect((err as TranscriptValidationError).reason).toBe("unknown_version");
    }
  });

  it("rejects a missing payment reference", () => {
    const withoutReference = {
      ...baseReceipt,
      traceId: "   ",
      payment: { ...baseReceipt.payment, transactionHash: null }
    };

    expect(() => validateReceiptForTranscript(withoutReference, "search.basic")).toThrow(
      TranscriptValidationError
    );

    try {
      validateReceiptForTranscript(withoutReference, "search.basic");
    } catch (err) {
      expect((err as TranscriptValidationError).reason).toBe("missing_payment_reference");
    }
  });

  it("rejects a mismatched provider", () => {
    expect(() => validateReceiptForTranscript(baseReceipt, "search.pro")).toThrow(
      TranscriptValidationError
    );

    try {
      validateReceiptForTranscript(baseReceipt, "search.pro");
    } catch (err) {
      expect((err as TranscriptValidationError).reason).toBe("mismatched_provider");
    }
  });
});

describe("appendReceiptToTranscript", () => {
  it("appends exactly one line for a valid receipt", () => {
    const transcriptPath = tempTranscriptPath();
    const line = appendReceiptToTranscript(transcriptPath, baseReceipt, "search.basic");

    const contents = fs.readFileSync(transcriptPath, "utf8");
    const lines = contents.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(line);
    expect(JSON.parse(line).providerId).toBe("search.basic");
    expect(JSON.parse(line).paymentReference).toBe(baseReceipt.payment.transactionHash);
  });

  it("leaves the previous transcript unchanged and throws on invalid receipt", () => {
    const transcriptPath = tempTranscriptPath();
    appendReceiptToTranscript(transcriptPath, baseReceipt, "search.basic");
    const before = fs.readFileSync(transcriptPath, "utf8");

    expect(() =>
      appendReceiptToTranscript(
        transcriptPath,
        { ...baseReceipt, schema: "query402.receipt.v9" },
        "search.basic"
      )
    ).toThrow(TranscriptValidationError);

    expect(fs.readFileSync(transcriptPath, "utf8")).toBe(before);
    expect(before.trimEnd().split("\n")).toHaveLength(1);
  });

  it("does not write a raw payment header into the file", () => {
    const transcriptPath = tempTranscriptPath();
    const smuggled = {
      ...baseReceipt,
      "payment-response": "raw_payment_header_value_should_never_land",
      "x-payment": "base64-looking-payment-payload"
    };

    const line = appendReceiptToTranscript(transcriptPath, smuggled, "search.basic");
    const contents = fs.readFileSync(transcriptPath, "utf8");

    expect(contents).not.toContain("raw_payment_header_value_should_never_land");
    expect(contents).not.toContain("base64-looking-payment-payload");
    expect(contents.toLowerCase()).not.toContain("payment-response");
    expect(contents.toLowerCase()).not.toContain("x-payment");
    expect(line).toBe(formatReceiptTranscriptLine(baseReceipt));
  });

  it("uses a temporary transcript file path supplied by the test", () => {
    const transcriptPath = tempTranscriptPath();
    expect(transcriptPath.startsWith(os.tmpdir())).toBe(true);
    appendReceiptToTranscript(transcriptPath, baseReceipt, "search.basic");
    expect(fs.existsSync(transcriptPath)).toBe(true);
  });
});
