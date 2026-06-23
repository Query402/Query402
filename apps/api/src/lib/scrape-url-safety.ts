import { lookup } from "node:dns/promises";
import net from "node:net";

export class UnsafeScrapeUrlError extends Error {
  constructor() {
    super("Scrape URL is not allowed");
    this.name = "UnsafeScrapeUrlError";
  }
}

export type ScrapeUrlSafetyOptions = {
  resolveHostname?: (hostname: string) => Promise<ResolvedAddress[]>;
};

export type SafeScrapeFetchOptions = ScrapeUrlSafetyOptions & {
  fetchImpl?: typeof fetch;
  maxRedirects?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
  acceptedContentTypes?: string[];
};

export type SafeScrapeFetchResult = {
  url: string;
  contentType: string;
  body: string;
};

type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_ACCEPTED_CONTENT_TYPES = ["text/html", "text/plain", "application/xhtml+xml", "application/xml"];

const IPV4_BLOCKED_RANGES: Array<[number, number]> = [
  [toIPv4Number("0.0.0.0"), toIPv4Number("0.255.255.255")],
  [toIPv4Number("10.0.0.0"), toIPv4Number("10.255.255.255")],
  [toIPv4Number("100.64.0.0"), toIPv4Number("100.127.255.255")],
  [toIPv4Number("127.0.0.0"), toIPv4Number("127.255.255.255")],
  [toIPv4Number("169.254.0.0"), toIPv4Number("169.254.255.255")],
  [toIPv4Number("172.16.0.0"), toIPv4Number("172.31.255.255")],
  [toIPv4Number("192.0.0.0"), toIPv4Number("192.0.0.255")],
  [toIPv4Number("192.88.99.0"), toIPv4Number("192.88.99.255")],
  [toIPv4Number("192.0.2.0"), toIPv4Number("192.0.2.255")],
  [toIPv4Number("192.168.0.0"), toIPv4Number("192.168.255.255")],
  [toIPv4Number("198.18.0.0"), toIPv4Number("198.19.255.255")],
  [toIPv4Number("198.51.100.0"), toIPv4Number("198.51.100.255")],
  [toIPv4Number("203.0.113.0"), toIPv4Number("203.0.113.255")],
  [toIPv4Number("224.0.0.0"), toIPv4Number("239.255.255.255")],
  [toIPv4Number("240.0.0.0"), toIPv4Number("255.255.255.255")]
];

function toIPv4Number(address: string) {
  return address.split(".").reduce((total, octet) => total * 256 + Number(octet), 0) >>> 0;
}

function parseIPv4(address: string) {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }

    const value = Number(part);
    return value >= 0 && value <= 255 ? value : null;
  });

  if (octets.some((octet) => octet === null)) {
    return null;
  }

  return octets.join(".");
}

function parseIPv4MappedIPv6(address: string) {
  const normalized = trimIPv6Brackets(address).toLowerCase();
  const marker = "::ffff:";
  if (!normalized.startsWith(marker)) {
    return null;
  }

  const value = normalized.slice(marker.length);
  const dotted = parseIPv4(value);
  if (dotted) {
    return dotted;
  }

  const parts = expandIPv6(normalized);
  if (!parts || parts.slice(0, 5).some((part) => part !== 0) || parts[5] !== 0xffff) {
    return null;
  }

  return [parts[6] >> 8, parts[6] & 0xff, parts[7] >> 8, parts[7] & 0xff].join(".");
}

function isBlockedIPv4(address: string) {
  const parsed = parseIPv4(address);
  if (!parsed) {
    return true;
  }

  const value = toIPv4Number(parsed);
  return IPV4_BLOCKED_RANGES.some(([start, end]) => value >= start && value <= end);
}

function expandIPv6(address: string) {
  const normalized = trimIPv6Brackets(address).toLowerCase();
  const [leftSide, rightSide] = normalized.split("::");
  const left = leftSide ? leftSide.split(":").filter(Boolean) : [];
  const right = rightSide ? rightSide.split(":").filter(Boolean) : [];
  const missing = 8 - left.length - right.length;

  if (missing < 0 || (normalized.includes("::") && normalized.split("::").length > 2)) {
    return null;
  }

  const parts = [...left, ...Array<string>(Math.max(0, missing)).fill("0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }

  return parts.map((part) => Number.parseInt(part, 16));
}

function trimIPv6Brackets(address: string) {
  return address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
}

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/\.+$/, "");
}

function isBlockedIPv6(address: string) {
  const mappedIPv4 = parseIPv4MappedIPv6(address);
  if (mappedIPv4) {
    return isBlockedIPv4(mappedIPv4);
  }

  const parts = expandIPv6(address);
  if (!parts) {
    return true;
  }

  const [first, second] = parts;
  const isUnspecified = parts.every((part) => part === 0);
  const isLoopback = parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1;
  const isIPv4Translation = first === 0x64 && second === 0xff9b;
  const isDocumentation = first === 0x2001 && second === 0xdb8;
  const isTeredo = first === 0x2001 && second === 0;
  const isBenchmarking = first === 0x2001 && second === 0x2;

  return (
    isUnspecified ||
    isLoopback ||
    isIPv4Translation ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xff00) === 0xff00 ||
    isDocumentation ||
    isTeredo ||
    isBenchmarking ||
    first === 0x2002 ||
    first === 0x3fff
  );
}

function isBlockedAddress(address: string, family?: number) {
  const mappedIPv4 = parseIPv4MappedIPv6(address);
  if (mappedIPv4) {
    return isBlockedIPv4(mappedIPv4);
  }

  if (family === 4 || net.isIPv4(address)) {
    return isBlockedIPv4(address);
  }

  const unwrapped = trimIPv6Brackets(address);
  if (family === 6 || net.isIPv6(unwrapped)) {
    return isBlockedIPv6(unwrapped);
  }

  return true;
}

function assertPublicAddress(address: string, family?: number) {
  if (isBlockedAddress(address, family)) {
    throw new UnsafeScrapeUrlError();
  }
}

function assertSafeUrlShape(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new UnsafeScrapeUrlError();
  }

  if (url.username || url.password) {
    throw new UnsafeScrapeUrlError();
  }

  const hostname = normalizeHostname(url.hostname);
  const lookupHostname = trimIPv6Brackets(hostname);
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new UnsafeScrapeUrlError();
  }

  if (hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new UnsafeScrapeUrlError();
  }

  if (net.isIP(lookupHostname)) {
    assertPublicAddress(lookupHostname, net.isIP(lookupHostname));
  }
}

async function defaultResolveHostname(hostname: string): Promise<ResolvedAddress[]> {
  const lookupHostname = trimIPv6Brackets(normalizeHostname(hostname));
  if (net.isIP(lookupHostname)) {
    return [{ address: lookupHostname, family: net.isIP(lookupHostname) as 4 | 6 }];
  }

  return lookup(lookupHostname, { all: true, verbatim: true }) as Promise<ResolvedAddress[]>;
}

export async function validateScrapeUrl(targetUrl: string, options: ScrapeUrlSafetyOptions = {}) {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    throw new UnsafeScrapeUrlError();
  }

  assertSafeUrlShape(url);

  const resolveHostname = options.resolveHostname ?? defaultResolveHostname;
  const addresses = await resolveHostname(trimIPv6Brackets(normalizeHostname(url.hostname)));
  if (addresses.length === 0) {
    throw new UnsafeScrapeUrlError();
  }

  for (const result of addresses) {
    assertPublicAddress(result.address, result.family);
  }

  return url.toString();
}

function isAcceptedContentType(contentType: string, acceptedContentTypes: string[]) {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return acceptedContentTypes.some((accepted) => normalized === accepted || normalized.endsWith(`+${accepted}`));
}

async function readLimitedBody(response: Response, maxResponseBytes: number, timeoutSignal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    if (timeoutSignal.aborted) {
      throw new UnsafeScrapeUrlError();
    }

    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    total += value.byteLength;
    if (total > maxResponseBytes) {
      await reader.cancel();
      throw new UnsafeScrapeUrlError();
    }

    chunks.push(value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function safeScrapeFetch(targetUrl: string, options: SafeScrapeFetchOptions = {}): Promise<SafeScrapeFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const acceptedContentTypes = options.acceptedContentTypes ?? DEFAULT_ACCEPTED_CONTENT_TYPES;
  let currentUrl = targetUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    currentUrl = await validateScrapeUrl(currentUrl, options);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(currentUrl, {
        redirect: "manual",
        signal: controller.signal
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirectCount === maxRedirects) {
          throw new UnsafeScrapeUrlError();
        }

        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!response.ok) {
        throw new UnsafeScrapeUrlError();
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!isAcceptedContentType(contentType, acceptedContentTypes)) {
        throw new UnsafeScrapeUrlError();
      }

      return {
        url: currentUrl,
        contentType,
        body: await readLimitedBody(response, maxResponseBytes, controller.signal)
      };
    } catch (error) {
      if (error instanceof UnsafeScrapeUrlError) {
        throw error;
      }

      throw new UnsafeScrapeUrlError();
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new UnsafeScrapeUrlError();
}
