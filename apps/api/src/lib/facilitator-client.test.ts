import { readFileSync } from "node:fs";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonFacilitatorClient } from "./facilitator-client.js";

const fixtures = JSON.parse(
  readFileSync(new URL("../test/fixtures/facilitator-responses.json", import.meta.url), "utf8")
) as {
  acceptedContentTypes: string[];
  rejectedContentTypes: Array<string | null>;
  proxyBody: string;
  invalidJsonBody: string;
  invalidDataBody: string;
  verify: object;
  settle: object;
  supported: object;
};

const requirements: PaymentRequirements = {
  scheme: "exact",
  network: "stellar:testnet",
  asset: "test-asset",
  amount: "10000",
  payTo: "test-payee",
  maxTimeoutSeconds: 60,
  extra: {}
};
const payment: PaymentPayload = { x402Version: 2, accepted: requirements, payload: {} };
const client = new JsonFacilitatorClient({ url: "https://facilitator.example.test/x402/" });

const operations = {
  verify: () => client.verify(payment, requirements),
  settle: () => client.settle(payment, requirements),
  supported: () => client.getSupported()
};

function mockResponse(body: string, contentType: string | null, status = 200) {
  const response = new Response(new TextEncoder().encode(body), {
    status,
    headers: contentType === null ? {} : { "Content-Type": contentType }
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  return response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(["verify", "settle", "supported"] as const)(
  "facilitator %s response",
  (operation) => {
    const run = operations[operation];

    it.each(fixtures.acceptedContentTypes)("accepts %s", async (contentType) => {
      mockResponse(JSON.stringify(fixtures[operation]), contentType);
      await expect(run()).resolves.toMatchObject(fixtures[operation]);
    });

    it.each(fixtures.rejectedContentTypes)(
      "rejects %s before reading the body",
      async (contentType) => {
        const response = mockResponse(fixtures.proxyBody, contentType);
        const json = vi.spyOn(response, "json");
        const text = vi.spyOn(response, "text");
        const cancel = vi.spyOn(response.body!, "cancel");

        await expect(run()).rejects.toMatchObject({
          name: "FacilitatorResponseError",
          message: `Facilitator ${operation} returned an unexpected content type`
        });
        expect(json).not.toHaveBeenCalled();
        expect(text).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledOnce();
      }
    );

    it("rejects valid JSON served as text/plain", async () => {
      mockResponse(JSON.stringify(fixtures[operation]), "text/plain");
      await expect(run()).rejects.toThrow(
        `Facilitator ${operation} returned an unexpected content type`
      );
    });

    it.each([
      [fixtures.invalidJsonBody, "invalid JSON"],
      [fixtures.invalidDataBody, "invalid data"]
    ])("redacts the body from parse and validation errors", async (body, reason) => {
      mockResponse(body, "application/json");
      await expect(run()).rejects.toMatchObject({
        name: "FacilitatorResponseError",
        message: `Facilitator ${operation} returned ${reason}`
      });
    });
  }
);

it("redacts a proxy error returned by verification", async () => {
  mockResponse(fixtures.proxyBody, "text/html", 502);
  await expect(operations.verify()).rejects.toThrow(
    "Facilitator verify returned an unexpected content type"
  );
});

it("preserves supported-endpoint HTTP errors without consuming their body", async () => {
  const response = mockResponse(fixtures.proxyBody, "text/html", 503);
  const json = vi.spyOn(response, "json");
  const text = vi.spyOn(response, "text");

  await expect(operations.supported()).rejects.toThrow(
    "Facilitator supported request failed (HTTP 503)"
  );
  expect(json).not.toHaveBeenCalled();
  expect(text).not.toHaveBeenCalled();
});

it("preserves typed facilitator payment rejections", async () => {
  mockResponse(
    JSON.stringify({ isValid: false, invalidReason: "invalid_payment" }),
    "application/json",
    400
  );
  await expect(operations.verify()).rejects.toMatchObject({
    name: "VerifyError",
    statusCode: 400,
    invalidReason: "invalid_payment"
  });

  mockResponse(
    JSON.stringify({ ...fixtures.settle, success: false, errorReason: "settlement_pending" }),
    "application/json",
    409
  );
  await expect(operations.settle()).rejects.toMatchObject({
    name: "SettleError",
    statusCode: 409,
    errorReason: "settlement_pending"
  });
});

it("preserves facilitator authorization and the x402 payment envelope", async () => {
  mockResponse(JSON.stringify(fixtures.verify), "application/json");
  const authenticatedClient = new JsonFacilitatorClient({
    url: "https://facilitator.example.test/x402/",
    createAuthHeaders: async () => ({ verify: { Authorization: "Bearer test-token" } })
  });

  await authenticatedClient.verify(payment, requirements);

  expect(fetch).toHaveBeenCalledWith(
    "https://facilitator.example.test/x402/verify",
    expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: payment,
        paymentRequirements: requirements
      })
    })
  );
});
