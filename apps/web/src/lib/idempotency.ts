import { createHash } from 'crypto';

const PROVIDER_SALT = process.env.PROVIDER_SALT || 'default-salt';

export function deriveIdempotencyKey(
  provider: string,
  query: string,
  paymentReference: string
): string {
  const input = `${PROVIDER_SALT}:${provider}:${query}:${paymentReference}`;
  return createHash('sha256').update(input).digest('hex');
}

export function isProtectedRoute(path: string): boolean {
  const protectedRoutes = ['/api/query', '/api/payment'];
  return protectedRoutes.some((route) => path.startsWith(route));
}