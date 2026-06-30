import { createHash } from "node:crypto";

export interface PaymentDebugMetadata {
  failureType: string;
  route: string;
  providerId: string;
  expectedPrice: string;
  facilitatorStatus?: string;
  paymentHeaderFingerprint?: string;
  traceId?: string;
  nextStep: string;
}

const SENSITIVE_REDACTED = "[REDACTED]";

export function redactSensitiveValue(_value: string): "[REDACTED]" {
  return SENSITIVE_REDACTED;
}

export function computePaymentHeaderFingerprint(paymentHeader?: string): string | undefined {
  if (!paymentHeader) return undefined;
  const hash = createHash("sha256").update(paymentHeader, "utf-8").digest("hex");
  return hash.slice(0, 16);
}

export function resolveNextStep(failureType: string): string {
  switch (failureType) {
    case "payment_required":
    case "no_payment_header":
      return "Retry payment";
    case "settlement_failed":
    case "quote_expired":
      return "Refresh quote";
    case "facilitator_unavailable":
      return "Check facilitator availability";
    case "invalid_payment_header":
    case "verification_failed":
      return "Verify payment header";
    default:
      return "Contact support with trace ID";
  }
}

export function buildPaymentDebugMetadata(input: {
  failureType: string;
  route: string;
  providerId: string;
  expectedPrice: string;
  facilitatorStatus?: string;
  paymentHeader?: string;
  traceId?: string;
}): PaymentDebugMetadata {
  return {
    failureType: input.failureType,
    route: input.route,
    providerId: input.providerId,
    expectedPrice: input.expectedPrice,
    nextStep: resolveNextStep(input.failureType),
    facilitatorStatus: input.facilitatorStatus,
    paymentHeaderFingerprint: computePaymentHeaderFingerprint(input.paymentHeader),
    traceId: input.traceId
  };
}
