import { URL } from "url";
import { promises as dns } from "dns";

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

const BLOCKED_PREFIXES: string[] = [
  // IPv4 loopback
  "127.",
  // IPv4 link-local
  "169.254.",
  // IPv4 private
  "10.",
  "192.168.",
  // 172.16.0.0/12
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  // IPv6 loopback/link-local/private
  "::1",
  "fec0",
  "fe80",
  "fc00",
  "fd00"
];

const BLOCKED_CLOUD_META = ["169.254.169.254", "[fd00:ec2::254]"];

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = [
  "text/html",
  "application/json",
  "text/plain",
  "application/xml",
  "text/xml"
];

export interface UrlPolicyResult {
  safe: boolean;
  sanitizedUrl: string;
  error?: string;
}

function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.startsWith("[") ? lower.slice(1, -1) : lower;
}

function isBlockedAddress(address: string): boolean {
  const normalized = normalizeHostname(address);

  if (BLOCKED_HOSTS.has(address.toLowerCase()) || BLOCKED_HOSTS.has(normalized)) {
    return true;
  }

  if (BLOCKED_CLOUD_META.includes(address.toLowerCase()) || BLOCKED_CLOUD_META.includes(normalized)) {
    return true;
  }

  for (const prefix of BLOCKED_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

export function validateUrl(raw: string): UrlPolicyResult {
  try {
    const url = new URL(raw);

    if (!["http:", "https::"].includes(url.protocol)) {
      return { safe: false, sanitizedUrl: "", error: "Only HTTP/HTTPS protocols are allowed" };
    }

    if (url.username || url.password) {
      return { safe: false, sanitizedUrl: "", error: "Credentials in URLs are not allowed" };
    }

    const hostname = url.hostname.toLowerCase();
    // IPv6 hostnames include brackets (e.g. "[fe80::1]"); strip them so prefix
    // checks match the address portion.
    const normalizedHostname = normalizeHostname(hostname);

    if (BLOCKED_HOSTS.has(hostname) || BLOCKED_CLOUD_META.includes(hostname)) {
      return { safe: false, sanitizedUrl: "", error: "URL targets a blocked host" };
    }

    if (isBlockedAddress(normalizedHostname)) {
      return { safe: false, sanitizedUrl: "", error: "URL targets a private/restricted network" };
    }

    const sanitized = url.protocol + "//" + url.hostname + url.pathname + url.search;

    return { safe: true, sanitizedUrl: sanitized };
  } catch {
    return { safe: false, sanitizedUrl: "", error: "Invalid URL format" };
  }
}

export async function resolveAndValidate(raw: string): Promise<UrlPolicyResult> {
  const result = validateUrl(raw);
  if (!result.safe) return result;

  try {
    const hostname = new URL(raw).hostname;
    const addresses = await dns.resolve(hostname);

    for (const addr of addresses) {
      if (isBlockedAddress(addr)) {
        return { safe: false, sanitizedUrl: "", error: "DNS resolved to a blocked address" };
      }
    }

    return result;
  } catch {
    return { safe: false, sanitizedUrl: "", error: "DNS resolution failed" };
  }
}

export function getRequestPolicy() {
  return {
    timeout: REQUEST_TIMEOUT_MS,
    maxResponseSize: MAX_RESPONSE_SIZE_BYTES,
    maxRedirects: MAX_REDIRECTS,
    allowedContentTypes: ALLOWED_CONTENT_TYPES,
    validateRedirect: (url: string) => validateUrl(url)
  };
}

export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.message.includes("DNS") || err.message.includes("ENOTFOUND")) {
      return "Unable to resolve the requested URL";
    }
    if (err.message.includes("ECONNREFUSED") || err.message.includes("ETIMEDOUT")) {
      return "The target server is not reachable";
    }
  }
  return "The request could not be completed due to security restrictions";
}
