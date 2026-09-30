import { deriveIdempotencyKey, isProtectedRoute } from './idempotency';

interface ApiRequestOptions extends RequestInit {
  paymentReference?: string;
  provider?: string;
  query?: string;
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: ApiRequestOptions
): Promise<Response> {
  const url = typeof input === 'string' ? input : input.url;
  const isProtected = isProtectedRoute(url);

  const headers = new Headers(init?.headers);

  if (isProtected && init?.paymentReference && init?.provider && init?.query) {
    const idempotencyKey = deriveIdempotencyKey(
      init.provider,
      init.query,
      init.paymentReference
    );
    headers.set('Idempotency-Key', idempotencyKey);
    headers.set('X-Payment-Reference', init.paymentReference);
  }

  return fetch(url, {
    ...init,
    headers,
  });
}