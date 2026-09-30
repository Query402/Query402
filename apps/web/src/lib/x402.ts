import { deriveIdempotencyKey } from './idempotency';

let lastKey: string | null = null;
let lastQuery: string | null = null;

export function validateIdempotencyKey(
  provider: string,
  query: string,
  paymentReference: string
): boolean {
  const currentKey = deriveIdempotencyKey(provider, query, paymentReference);

  if (lastKey && lastQuery && lastQuery !== query && lastKey === currentKey) {
    throw new Error('Idempotency key reused across different queries');
  }

  lastKey = currentKey;
  lastQuery = query;
  return true;
}

export function resetIdempotencyTracking(): void {
  lastKey = null;
  lastQuery = null;
}