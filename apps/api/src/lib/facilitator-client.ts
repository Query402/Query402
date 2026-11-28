import {
  FacilitatorResponseError,
  FacilitatorTimeoutError,
  HTTPFacilitatorClient
} from "@x402/core/server";
import { SettleError, VerifyError } from "@x402/core/types";
import type { Network, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { z } from "zod";

type Operation = "verify" | "settle" | "supported";

const jsonContentType =
  /^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:[\w!#$%&'*+.^`|~-]+|"[\w!#$%&'*+.^`|~-]+"))?$/i;

const optionalString = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);
const optionalRecord = z
  .record(z.unknown())
  .nullish()
  .transform((value) => value ?? undefined);
const network = z.custom<Network>((value) => typeof value === "string");

const verifySchema = z.object({
  isValid: z.boolean(),
  invalidReason: optionalString,
  invalidMessage: optionalString,
  payer: optionalString,
  extensions: optionalRecord,
  extra: optionalRecord
});

const settleSchema = z.object({
  success: z.boolean(),
  errorReason: optionalString,
  errorMessage: optionalString,
  payer: optionalString,
  transaction: z.string(),
  network,
  amount: optionalString,
  extensions: optionalRecord,
  extra: optionalRecord
});

const supportedSchema = z.object({
  kinds: z.array(
    z.object({
      x402Version: z.number(),
      scheme: z.string(),
      network,
      extra: optionalRecord
    })
  ),
  extensions: z.array(z.string()).default([]),
  signers: z.record(z.array(z.string())).default({})
});

function retryDelay(retryAfter: string | null, attempt: number): number {
  const header = retryAfter?.trim() ?? "";
  const delay = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return Math.min(delay > 0 ? delay : 1000 * 2 ** attempt, 30_000);
}

function extensionResponses(headers: Headers): Record<string, unknown> | undefined {
  const header = headers.get("EXTENSION-RESPONSES");
  if (!header) return undefined;

  try {
    const value: unknown = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed extension metadata.
  }
}

async function parseResponse<T>(
  response: Response,
  operation: Operation,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  signal: AbortSignal
): Promise<T> {
  if (!jsonContentType.test(response.headers.get("Content-Type")?.trim() ?? "")) {
    discardBody(response);
    throw new FacilitatorResponseError(
      `Facilitator ${operation} returned an unexpected content type`
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    signal.throwIfAborted();
    throw new FacilitatorResponseError(`Facilitator ${operation} returned invalid JSON`);
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new FacilitatorResponseError(`Facilitator ${operation} returned invalid data`);
  }
  return result.data;
}

function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

// The SDK owns URL and auth configuration but does not expose a hook before parsing.
export class JsonFacilitatorClient extends HTTPFacilitatorClient {
  override async verify(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements) {
    return this.request(
      "verify",
      async (response, signal) => {
        const data = await parseResponse(response, "verify", verifySchema, signal);
        if (!response.ok) throw new VerifyError(response.status, data);
        const extensions = extensionResponses(response.headers);
        return extensions ? { ...data, extensionResponses: extensions } : data;
      },
      { paymentPayload, paymentRequirements }
    );
  }

  override async settle(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements) {
    return this.request(
      "settle",
      async (response, signal) => {
        const data = await parseResponse(response, "settle", settleSchema, signal);
        if (!response.ok) throw new SettleError(response.status, data);
        const extensions = extensionResponses(response.headers);
        return extensions ? { ...data, extensionResponses: extensions } : data;
      },
      { paymentPayload, paymentRequirements }
    );
  }

  override async getSupported() {
    for (let attempt = 0; ; attempt++) {
      const result = await this.request("supported", async (response, signal) => {
        if (response.ok) {
          return {
            ok: true as const,
            data: await parseResponse(response, "supported", supportedSchema, signal)
          };
        }
        discardBody(response);
        return {
          ok: false as const,
          status: response.status,
          retryAfter: response.headers.get("Retry-After")
        };
      });
      if (result.ok) return result.data;
      if (result.status !== 429 || attempt === 2) {
        throw new Error(`Facilitator supported request failed (HTTP ${result.status})`);
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelay(result.retryAfter, attempt)));
    }
  }

  private async request<T>(
    operation: Operation,
    handleResponse: (response: Response, signal: AbortSignal) => Promise<T>,
    payment?: { paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements }
  ): Promise<T> {
    const { headers } = await this.createAuthHeaders(operation);
    const signal = AbortSignal.timeout(this.timeoutMs);

    try {
      const response = await fetch(`${this.url}/${operation}`, {
        method: payment ? "POST" : "GET",
        headers: { "Content-Type": "application/json", ...headers },
        body: payment
          ? JSON.stringify(
              { x402Version: payment.paymentPayload.x402Version, ...payment },
              (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value)
            )
          : undefined,
        signal
      });
      return await handleResponse(response, signal);
    } catch (error) {
      if (signal.aborted) throw new FacilitatorTimeoutError(operation, this.timeoutMs);
      throw error;
    }
  }
}
