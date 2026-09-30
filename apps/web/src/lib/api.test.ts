import { apiFetch } from './api';
import { deriveIdempotencyKey, isProtectedRoute } from './idempotency';

global.fetch = jest.fn();

describe('apiFetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('attaches idempotency key and payment header to protected route', async () => {
    const mockResponse = { ok: true };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    await apiFetch('/api/query', {
      method: 'POST',
      provider: 'test-provider',
      query: 'test-query',
      paymentReference: 'test-ref',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/query',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': expect.any(String),
          'X-Payment-Reference': 'test-ref',
        }),
      })
    );
  });

  it('does not attach payment header to public route', async () => {
    const mockResponse = { ok: true };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    await apiFetch('/public/data', {
      method: 'GET',
      provider: 'test-provider',
      query: 'test-query',
      paymentReference: 'test-ref',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/public/data',
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'Idempotency-Key': expect.any(String),
          'X-Payment-Reference': expect.any(String),
        }),
      })
    );
  });

  it('derives different keys for different queries', () => {
    const key1 = deriveIdempotencyKey('provider', 'query1', 'ref1');
    const key2 = deriveIdempotencyKey('provider', 'query2', 'ref1');
    expect(key1).not.toBe(key2);
  });
});

describe('isProtectedRoute', () => {
  it('identifies protected routes', () => {
    expect(isProtectedRoute('/api/query')).toBe(true);
    expect(isProtectedRoute('/api/payment')).toBe(true);
    expect(isProtectedRoute('/public/data')).toBe(false);
  });
});