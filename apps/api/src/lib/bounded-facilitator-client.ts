import { FacilitatorResponseError } from "@x402/core/server";

/** Maximum accepted size for any facilitator response body. */
export const FACILITATOR_MAX_RESPONSE_BYTES = 256 * 1024;

export class FacilitatorResponseTooLargeError extends FacilitatorResponseError {
  constructor(maxBytes = FACILITATOR_MAX_RESPONSE_BYTES) {
    super(`Facilitator response exceeded ${maxBytes}-byte limit`);
    this.name = "FacilitatorResponseTooLargeError";
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new FacilitatorResponseTooLargeError(maxBytes);
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return text + decoder.decode();
      }

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new FacilitatorResponseTooLargeError(maxBytes);
      }

      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) {
    return input.url;
  }
  return input.toString();
}

function isFacilitatorEndpoint(input: RequestInfo | URL, facilitatorUrls: Set<string>): boolean {
  try {
    const request = new URL(requestUrl(input));
    for (const facilitatorUrl of facilitatorUrls) {
      const base = new URL(facilitatorUrl);
      const basePath = base.pathname.replace(/\/+$/, "");
      const endpoint = request.pathname.slice(basePath.length + 1);
      if (
        request.origin === base.origin &&
        request.pathname.startsWith(`${basePath}/`) &&
        (endpoint === "verify" || endpoint === "settle" || endpoint === "supported")
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export function createBoundedFacilitatorFetch(
  fetcher: typeof fetch,
  matchesFacilitatorEndpoint: (input: RequestInfo | URL) => boolean,
  maxBytes = FACILITATOR_MAX_RESPONSE_BYTES
): typeof fetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    if (!matchesFacilitatorEndpoint(input)) {
      return response;
    }

    const text = await readBoundedText(response, maxBytes);
    return new Response(text || null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  };
}

const facilitatorUrls = new Set<string>();
let boundedFetch: typeof fetch | undefined;

export function registerFacilitatorResponseLimit(facilitatorUrl: string): void {
  facilitatorUrls.add(facilitatorUrl.replace(/\/+$/, ""));
  if (boundedFetch && globalThis.fetch === boundedFetch) {
    return;
  }

  // The SDK exposes no fetch injection point, so scope the wrapper to this facilitator's endpoints.
  boundedFetch = createBoundedFacilitatorFetch(globalThis.fetch.bind(globalThis), (input) =>
    isFacilitatorEndpoint(input, facilitatorUrls)
  );
  globalThis.fetch = boundedFetch;
}
