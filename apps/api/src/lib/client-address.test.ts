import express from "express";
import type { Request } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  NO_TRUSTED_PROXIES,
  normalizeIpAddress,
  parseTrustedProxies,
  resolveClientAddress,
  UNKNOWN_CLIENT_ADDRESS
} from "./client-address.js";
import { createChallengeRateLimit } from "./challenge-rate-limit.js";

function fakeRequest(remoteAddress: string | undefined, headers: Record<string, string> = {}) {
  return { socket: { remoteAddress }, headers } as unknown as Request;
}

describe("normalizeIpAddress", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    [" 203.0.113.7 ", "203.0.113.7"],
    ["203.0.113.7:4711", "203.0.113.7"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["0:0:0:0:0:ffff:203.0.113.7", "203.0.113.7"],
    ["2001:DB8::1", "2001:db8::1"],
    ["[2001:db8::1]:4711", "2001:db8::1"],
    ['"[2001:db8::1]:4711"', "2001:db8::1"],
    ["fe80::1%eth0", "fe80::1"]
  ])("normalizes %s", (raw, expected) => {
    expect(normalizeIpAddress(raw)).toBe(expected);
  });

  it.each(["", "unknown", "_hidden", "not-an-ip", "[2001:db8::1", "999.1.1.1", undefined])(
    "rejects %s",
    (raw) => {
      expect(normalizeIpAddress(raw)).toBeUndefined();
    }
  );
});

describe("parseTrustedProxies", () => {
  it("is disabled when unset or blank", () => {
    expect(parseTrustedProxies(undefined).enabled).toBe(false);
    expect(parseTrustedProxies(" , ").enabled).toBe(false);
  });

  it("accepts addresses and CIDR ranges", () => {
    const config = parseTrustedProxies("10.0.0.0/8, 127.0.0.1, ::1, fd00::/8");
    expect(config.enabled).toBe(true);
    expect(config.proxies.check("10.1.2.3", "ipv4")).toBe(true);
    expect(config.proxies.check("127.0.0.1", "ipv4")).toBe(true);
    expect(config.proxies.check("fd12::1", "ipv6")).toBe(true);
    expect(config.proxies.check("203.0.113.7", "ipv4")).toBe(false);
  });

  it.each(["not-an-ip", "10.0.0.0/33", "10.0.0.0/abc", "::1/129"])(
    "rejects invalid entry %s",
    (entry) => {
      expect(() => parseTrustedProxies(entry)).toThrow(/Invalid trusted proxy entry/);
    }
  );
});

describe("resolveClientAddress", () => {
  const spoofHeaders = {
    "x-forwarded-for": "198.51.100.99",
    forwarded: "for=198.51.100.99"
  };

  it("ignores X-Forwarded-For and Forwarded by default", () => {
    const req = fakeRequest("203.0.113.7", spoofHeaders);
    expect(resolveClientAddress(req)).toBe("203.0.113.7");
    expect(resolveClientAddress(req, NO_TRUSTED_PROXIES)).toBe("203.0.113.7");
  });

  it("ignores forwarding headers from peers that are not trusted proxies", () => {
    const trusted = parseTrustedProxies("10.0.0.0/8");
    expect(resolveClientAddress(fakeRequest("203.0.113.7", spoofHeaders), trusted)).toBe(
      "203.0.113.7"
    );
  });

  it("normalizes the peer address", () => {
    expect(resolveClientAddress(fakeRequest("::ffff:203.0.113.7"))).toBe("203.0.113.7");
    expect(resolveClientAddress(fakeRequest(undefined))).toBe(UNKNOWN_CLIENT_ADDRESS);
  });

  it("uses the forwarded client when the peer is a trusted proxy", () => {
    const trusted = parseTrustedProxies("10.0.0.1");
    const req = fakeRequest("::ffff:10.0.0.1", { "x-forwarded-for": "198.51.100.20" });
    expect(resolveClientAddress(req, trusted)).toBe("198.51.100.20");
  });

  it("takes the right-most untrusted hop so client-supplied prefixes are ignored", () => {
    const trusted = parseTrustedProxies("10.0.0.0/8");
    const req = fakeRequest("10.0.0.1", {
      "x-forwarded-for": "1.1.1.1, 2.2.2.2, 198.51.100.20, 10.0.0.2"
    });
    expect(resolveClientAddress(req, trusted)).toBe("198.51.100.20");
  });

  it("stops at a malformed hop and keeps the last vouched address", () => {
    const trusted = parseTrustedProxies("10.0.0.0/8");
    const req = fakeRequest("10.0.0.1", { "x-forwarded-for": "198.51.100.20, garbage" });
    expect(resolveClientAddress(req, trusted)).toBe("10.0.0.1");
  });

  it("reads only the configured header", () => {
    const xff = parseTrustedProxies("10.0.0.1", "x-forwarded-for");
    const fwd = parseTrustedProxies("10.0.0.1", "forwarded");
    const req = fakeRequest("10.0.0.1", {
      "x-forwarded-for": "198.51.100.1",
      forwarded: 'for="[2001:db8::17]:4711";proto=https, for=10.0.0.5'
    });
    expect(resolveClientAddress(req, xff)).toBe("198.51.100.1");
    expect(resolveClientAddress(req, parseTrustedProxies("10.0.0.0/8", "forwarded"))).toBe(
      "2001:db8::17"
    );
    expect(resolveClientAddress(req, fwd)).toBe("10.0.0.5");
  });

  it("does not consult Express trust proxy / req.ip", () => {
    const req = { ...fakeRequest("203.0.113.7", spoofHeaders), ip: "198.51.100.99" } as Request;
    expect(resolveClientAddress(req)).toBe("203.0.113.7");
  });
});

describe("challenge rate limit client identity", () => {
  function buildApp(options: Parameters<typeof createChallengeRateLimit>[0], trustProxy = false) {
    const app = express();
    // Even if Express is configured to trust proxies, the limiter must not.
    if (trustProxy) app.set("trust proxy", true);
    app.use(createChallengeRateLimit(options));
    app.get("/challenge", (_req, res) => res.sendStatus(204));
    return app;
  }

  it("cannot be bypassed by rotating spoofed forwarding headers", async () => {
    const app = buildApp({ limit: 1, now: () => 0 }, true);

    await request(app).get("/challenge").set("X-Forwarded-For", "198.51.100.1").expect(204);
    await request(app).get("/challenge").set("X-Forwarded-For", "198.51.100.2").expect(429);
    await request(app).get("/challenge").set("Forwarded", "for=198.51.100.3").expect(429);
  });

  it("separates clients by forwarded address behind a trusted proxy", async () => {
    // supertest connects over loopback, so loopback acts as the proxy here.
    const app = buildApp({
      limit: 1,
      now: () => 0,
      trustedProxies: parseTrustedProxies("127.0.0.1, ::1")
    });

    await request(app).get("/challenge").set("X-Forwarded-For", "198.51.100.1").expect(204);
    await request(app).get("/challenge").set("X-Forwarded-For", "198.51.100.1").expect(429);
    await request(app).get("/challenge").set("X-Forwarded-For", "198.51.100.2").expect(204);
    // IPv4-mapped form of an already-limited client shares its bucket.
    await request(app).get("/challenge").set("X-Forwarded-For", "::ffff:198.51.100.2").expect(429);
  });
});
