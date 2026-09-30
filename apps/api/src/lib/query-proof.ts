import { createHash } from "node:crypto";
import type { Request } from "express";

export class PaymentProofError extends Error {
  constructor() {
    super("payment_proof_mismatch");
    this.name = "PaymentProofError";
  }
}

export interface PaymentProof {
  digest: string;
  asset: string;
  amount: string;
}

export function queryCoverageDigest(input: { provider: string; target: string; price: string }): string {
  return createHash("sha256")
    .update(`${input.provider}\n${input.target}\n${input.price}`)
    .digest("hex");
}

export function assertProofCoversQuery(input: {
  provider: string;
  target: string;
  price: string;
  asset: string;
  amount: string;
  proof: PaymentProof | null;
}): void {
  if (!input.proof) {
    throw new PaymentProofError();
  }

  const digest = queryCoverageDigest({
    provider: input.provider,
    target: input.target,
    price: input.price
  });

  if (
    input.proof.digest !== digest ||
    input.proof.asset !== input.asset ||
    input.proof.amount !== input.amount
  ) {
    throw new PaymentProofError();
  }
}

/** Read a proof binding. The thrown error never includes the raw header. */
export function proofFromHeader(req: Request): PaymentProof | null {
  const raw = req.header("x-query402-proof");
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PaymentProof>;
    if (
      typeof parsed.digest !== "string" ||
      typeof parsed.asset !== "string" ||
      typeof parsed.amount !== "string"
    ) {
      throw new PaymentProofError();
    }
    return { digest: parsed.digest, asset: parsed.asset, amount: parsed.amount };
  } catch (error) {
    if (error instanceof PaymentProofError) {
      throw error;
    }
    throw new PaymentProofError();
  }
}
