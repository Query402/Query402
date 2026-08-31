import { describe, expect, it } from "vitest";
import {
  validateUrl,
  resolveAndValidate,
  getRequestPolicy,
  safeErrorMessage
} from "./urlSafety.js";

describe("validateUrl", () => {
  it("allows public HTTPS URLs", () => {
    const result = validateUrl("https://developers.stellar.org/docs");
    expect(result.safe).toBe(true);
  });

  it("allows public HTTP URLs", () => {
    const result = validateUrl("http://example.com/page");
    expect(result.safe).toBe(true);
  });

  it("rejects FTP protocol", () => {
    const result = validateUrl("ftp://files.example.com");
    expect(result.safe).toBe(false);
  });

  it("rejects URLs with credentials", () => {
    const result = validateUrl("https://user:pass@example.com");
    expect(result.safe).toBe(false);
  });

  it("rejects localhost", () => {
    const result = validateUrl("http://localhost:3000/admin");
    expect(result.safe).toBe(false);
  });

  it("rejects 127.0.0.1", () => {
    const result = validateUrl("http://127.0.0.1:8080");
    expect(result.safe).toBe(false);
  });

  it("rejects 192.168.x.x", () => {
    const result = validateUrl("http://192.168.1.100");
    expect(result.safe).toBe(false);
  });

  it("rejects 10.x.x.x", () => {
    const result = validateUrl("http://10.0.0.5");
    expect(result.safe).toBe(false);
  });

  it("rejects 172.16.x.x", () => {
    const result = validateUrl("http://172.16.0.1");
    expect(result.safe).toBe(false);
  });

  it("rejects link-local 169.254.x.x", () => {
    const result = validateUrl("http://169.254.1.1");
    expect(result.safe).toBe(false);
  });

  it("rejects cloud metadata IP", () => {
    const result = validateUrl("http://169.254.169.254/latest/meta-data");
    expect(result.safe).toBe(false);
  });

  it("rejects IPv6 loopback", () => {
    const result = validateUrl("http://[::1]:8080");
    expect(result.safe).toBe(false);
  });

  it("rejects IPv6 link-local", () => {
    const result = validateUrl("http://[fe80::1]:8080");
    expect(result.safe).toBe(false);
  });

  it("sanitizes URL by removing fragment", () => {
    const result = validateUrl("https://example.com/page?q=1");
    expect(result.sanitizedUrl).toBe("https://example.com/page?q=1");
  });

  it("returns safe error message without internal details", () => {
    const msg = safeErrorMessage(new Error("ECONNREFUSED"));
    expect(msg).toContain("not reachable");
    expect(msg).not.toContain("ECONNREFUSED");
  });
});

describe("getRequestPolicy", () => {
  it("returns timeout, size limit, and redirect limit", () => {
    const policy = getRequestPolicy();
    expect(policy.timeout).toBeGreaterThan(0);
    expect(policy.maxResponseSize).toBeGreaterThan(0);
    expect(policy.maxRedirects).toBeGreaterThan(0);
    expect(policy.allowedContentTypes).toContain("text/html");
  });
});
