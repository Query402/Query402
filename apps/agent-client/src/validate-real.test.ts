import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("safeFacilitatorUrl", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns host for valid facilitator URL", async () => {
    const { safeFacilitatorUrl } = await import("./validate-real.js");
    expect(safeFacilitatorUrl("https://channels.openzeppelin.com/x402/testnet")).toBe(
      "channels.openzeppelin.com"
    );
  });

  it("strips auth credentials from URL", async () => {
    const { safeFacilitatorUrl } = await import("./validate-real.js");
    expect(
      safeFacilitatorUrl("https://user:password@channels.openzeppelin.com/x402/testnet")
    ).toBe("channels.openzeppelin.com");
  });

  it("preserves port in host", async () => {
    const { safeFacilitatorUrl } = await import("./validate-real.js");
    expect(safeFacilitatorUrl("https://channels.openzeppelin.com:8443/x402/testnet")).toBe(
      "channels.openzeppelin.com:8443"
    );
  });

  it("returns null for empty string", async () => {
    const { safeFacilitatorUrl } = await import("./validate-real.js");
    expect(safeFacilitatorUrl("")).toBeNull();
  });

  it("returns null for undefined", async () => {
    const { safeFacilitatorUrl } = await import("./validate-real.js");
    expect(safeFacilitatorUrl(undefined)).toBeNull();
  });

  it("returns null for invalid URL", async () => {
    const { safeFacilitatorUrl } = await import("./validate-real.js");
    expect(safeFacilitatorUrl("not-a-valid-url")).toBeNull();
  });
});

describe("formatTimestamp", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ISO 8601 formatted string", async () => {
    const { formatTimestamp } = await import("./validate-real.js");
    const ts = formatTimestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
