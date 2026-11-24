import { randomUUID } from "node:crypto";

const idempotencyKeys = new Map<string, string>();

export function buildPaidClientRequestKey(input: {
  route: string;
  mode: string;
  provider: string;
  query?: string;
  url?: string;
  payer: string;
  amount?: string;
  asset?: string;
  network?: string;
}) {
  return JSON.stringify({
    route: input.route,
    mode: input.mode,
    provider: input.provider,
    query: input.query ?? null,
    url: input.url ?? null,
    payer: input.payer,
    amount: input.amount ?? null,
    asset: input.asset ?? null,
    network: input.network ?? null
  });
}

export function getIdempotencyKey(requestKey: string): string {
  const existing = idempotencyKeys.get(requestKey);
  if (existing) {
    return existing;
  }

  const key = randomUUID();
  idempotencyKeys.set(requestKey, key);
  return key;
}
