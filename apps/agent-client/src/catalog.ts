import { providerCatalogResponseSchema, type ProviderCatalogResponse } from "@query402/shared";

/**
 * Documented maximum size of the /api/providers response the agent client will
 * buffer. The catalog is a small, static list; anything larger is treated as a
 * misconfigured or hostile API and rejected before payment validation.
 */
export const MAX_CATALOG_RESPONSE_BYTES = 512 * 1024;

export type CatalogResponseErrorCode = "catalog_too_large" | "catalog_invalid";

/**
 * Stable catalog failure. Messages never echo response body bytes so a
 * compromised API cannot smuggle content into logs or typed errors.
 */
export class CatalogResponseError extends Error {
  readonly code: CatalogResponseErrorCode;

  constructor(code: CatalogResponseErrorCode, message: string) {
    super(message);
    this.name = "CatalogResponseError";
    this.code = code;
  }
}

function declaredContentLength(response: Response): number | null {
  const raw = response.headers.get("content-length");
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  return Number(trimmed);
}

function tooLarge(maxBytes: number) {
  return new CatalogResponseError(
    "catalog_too_large",
    `Provider catalog response exceeds the ${maxBytes}-byte limit`
  );
}

/**
 * Read the catalog body while enforcing a byte limit. An oversized
 * Content-Length is rejected before any body is read; chunked responses are
 * rejected as soon as the streamed total passes the limit.
 */
export async function readCatalogText(
  response: Response,
  maxBytes: number = MAX_CATALOG_RESPONSE_BYTES
): Promise<string> {
  const declared = declaredContentLength(response);
  if (declared !== null && declared > maxBytes) {
    throw tooLarge(maxBytes);
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw tooLarge(maxBytes);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buffer);
}

/**
 * Parse a catalog body with the shared strict schema. Validation failures are
 * reported by code only, never by echoing untrusted content.
 */
export function parseProviderCatalog(text: string): ProviderCatalogResponse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new CatalogResponseError("catalog_invalid", "Provider catalog is not valid JSON");
  }

  const parsed = providerCatalogResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new CatalogResponseError(
      "catalog_invalid",
      "Provider catalog failed schema validation"
    );
  }
  return parsed.data;
}
