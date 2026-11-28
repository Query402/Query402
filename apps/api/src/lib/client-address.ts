import { BlockList, isIP } from "node:net";
import type { Request } from "express";

/**
 * Which forwarding header a trusted proxy writes the client address into.
 * Only one header is consulted so a client cannot smuggle a spoofed value
 * through the header the proxy does not rewrite.
 */
export type TrustedProxyHeader = "x-forwarded-for" | "forwarded";

export type TrustedProxyConfig = {
  /** Proxy addresses/CIDR ranges whose forwarding headers are believed. */
  proxies: BlockList;
  /** True when at least one proxy entry is configured. */
  enabled: boolean;
  header: TrustedProxyHeader;
};

/** Upper bound on forwarded hops inspected, to keep per-request work bounded. */
const MAX_FORWARDED_HOPS = 32;

export const UNKNOWN_CLIENT_ADDRESS = "unknown-client";

export const NO_TRUSTED_PROXIES: TrustedProxyConfig = {
  proxies: new BlockList(),
  enabled: false,
  header: "x-forwarded-for"
};

/**
 * Normalize a raw address token into a canonical IP string, or return
 * undefined when the token is not an IP address.
 *
 * Handles surrounding quotes, `[v6]:port` and `v4:port` forms, IPv6 zone ids,
 * case, and IPv4-mapped IPv6 (`::ffff:203.0.113.7` -> `203.0.113.7`).
 */
export function normalizeIpAddress(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  let value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    value = value.slice(1, -1).trim();
  }
  if (!value) return undefined;

  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end === -1) return undefined;
    const rest = value.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return undefined;
    value = value.slice(1, end);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(value)) {
    value = value.slice(0, value.lastIndexOf(":"));
  }

  const zoneIndex = value.indexOf("%");
  if (zoneIndex !== -1) value = value.slice(0, zoneIndex);
  value = value.toLowerCase();

  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return undefined;

  const mapped = /^(?:::|(?:0{1,4}:){5})ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];

  return value;
}

function addToBlockList(list: BlockList, entry: string) {
  const slash = entry.indexOf("/");
  const address = normalizeIpAddress(slash === -1 ? entry : entry.slice(0, slash));
  if (!address) throw new Error(`Invalid trusted proxy entry: ${entry}`);
  const type = isIP(address) === 4 ? "ipv4" : "ipv6";

  if (slash === -1) {
    list.addAddress(address, type);
    return;
  }

  const prefixText = entry.slice(slash + 1);
  const prefix = Number(prefixText);
  const max = type === "ipv4" ? 32 : 128;
  if (!/^\d{1,3}$/.test(prefixText) || prefix > max) {
    throw new Error(`Invalid trusted proxy entry: ${entry}`);
  }
  list.addSubnet(address, prefix, type);
}

/**
 * Parse a comma-separated list of proxy IPs / CIDR ranges
 * (e.g. `10.0.0.0/8, 127.0.0.1, ::1`). An empty or missing value disables
 * forwarded-header handling entirely. Invalid entries throw so a typo cannot
 * silently fall back to an unexpected trust model.
 */
export function parseTrustedProxies(
  value: string | undefined,
  header: TrustedProxyHeader = "x-forwarded-for"
): TrustedProxyConfig {
  const entries = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const proxies = new BlockList();
  for (const entry of entries) addToBlockList(proxies, entry);

  return { proxies, enabled: entries.length > 0, header };
}

function isTrusted(address: string, config: TrustedProxyConfig): boolean {
  return config.proxies.check(address, isIP(address) === 4 ? "ipv4" : "ipv6");
}

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value.join(",");
  return value;
}

/** Raw per-hop tokens, ordered client-first as the proxies appended them. */
function forwardedHops(req: Request, header: TrustedProxyHeader): string[] {
  const value = headerValue(req, header);
  if (!value) return [];

  const elements = value.split(",");
  if (header === "x-forwarded-for") return elements;

  // RFC 7239: each element is `;`-separated pairs; take the `for=` parameter.
  // An element without `for=` yields an empty token, which stops the walk.
  return elements.map((element) => {
    for (const pair of element.split(";")) {
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      if (pair.slice(0, eq).trim().toLowerCase() === "for") return pair.slice(eq + 1);
    }
    return "";
  });
}

/**
 * Determine the client address used for rate limiting.
 *
 * By default only the TCP peer address is used; X-Forwarded-For and Forwarded
 * are ignored, so public clients cannot choose their own identity. When
 * trusted proxies are configured and the peer is one of them, the configured
 * forwarding header is walked right-to-left, skipping trusted hops, and the
 * first untrusted address is returned. Express's `trust proxy` / `req.ip` is
 * intentionally not consulted so this policy cannot be widened elsewhere.
 */
export function resolveClientAddress(
  req: Request,
  config: TrustedProxyConfig = NO_TRUSTED_PROXIES
): string {
  const peer = normalizeIpAddress(req.socket?.remoteAddress);
  if (!peer) return UNKNOWN_CLIENT_ADDRESS;
  if (!config.enabled || !isTrusted(peer, config)) return peer;

  const hops = forwardedHops(req, config.header).slice(-MAX_FORWARDED_HOPS);
  let client = peer;
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    if (!isTrusted(client, config)) break;
    const hop = normalizeIpAddress(hops[i]);
    // A malformed or obfuscated hop ends the chain; keep the last address a
    // trusted proxy actually vouched for.
    if (!hop) break;
    client = hop;
  }
  return client;
}
