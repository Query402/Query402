import { describe, expect, it } from "vitest";
import {
  DEFAULT_STALE_THRESHOLD_MS,
  deriveFreshness,
  type DeriveFreshnessInput
} from "./freshness.js";

const NOW = Date.parse("2026-06-29T12:00:00.000Z");

function minutes(min: number) {
  return min * 60_000;
}

function build(overrides: Partial<DeriveFreshnessInput> = {}): DeriveFreshnessInput {
  return {
    now: NOW,
    ...overrides
  };
}

describe("deriveFreshness", () => {
  describe("unknown kind fallback", () => {
    it("renders generic copy for an unrecognized kind value", () => {
      const view = deriveFreshness(
        build({
          kind: "refunded",
          capturedAt: new Date(NOW - 4_000).toISOString()
        })
      );
      expect(view.state).toBe("fresh");
      expect(view.isDemo).toBe(false);
      expect(view.label).toMatch(/Fresh proof/);
      expect(view.label).not.toMatch(/refunded/);
      expect(view.label).toContain("4s ago");
    });

    it("renders generic stale copy for an unrecognized kind value", () => {
      const view = deriveFreshness(
        build({
          kind: "refunded",
          capturedAt: new Date(NOW - minutes(7)).toISOString()
        })
      );
      expect(view.state).toBe("stale");
      expect(view.label).toMatch(/Stale proof/);
      expect(view.label).not.toMatch(/refunded/);
    });
  });

  describe("missing proof timestamp", () => {
    it("renders as unavailable (not fresh) when capturedAt is missing", () => {
      const view = deriveFreshness(build({ kind: "settled" }));
      expect(view.state).toBe("unavailable");
      expect(view.ageMs).toBeNull();
      expect(view.isDemo).toBe(false);
      expect(view.label).toContain("Proof timestamp unavailable");
    });

    it("renders as unavailable when capturedAt is an empty string", () => {
      const view = deriveFreshness(build({ kind: "verified", capturedAt: "" }));
      expect(view.state).toBe("unavailable");
      expect(view.ageMs).toBeNull();
    });

    it("renders as unavailable when capturedAt is null", () => {
      const view = deriveFreshness(build({ kind: "verified", capturedAt: null }));
      expect(view.state).toBe("unavailable");
      expect(view.ageMs).toBeNull();
    });

    it("renders as unavailable when capturedAt is malformed", () => {
      const view = deriveFreshness(build({ kind: "settled", capturedAt: "not-a-timestamp" }));
      expect(view.state).toBe("unavailable");
      expect(view.ageMs).toBeNull();
    });

    it("does not imply settlement in tooltip when unavailable", () => {
      const view = deriveFreshness(build({ kind: "settled" }));
      expect(view.tooltip).not.toMatch(/settled/i);
      expect(view.tooltip).not.toMatch(/on-chain/i);
    });

    it("uses demo-flavored copy when unavailable for demo evidence", () => {
      const view = deriveFreshness(build({ kind: "demo" }));
      expect(view.state).toBe("unavailable");
      expect(view.isDemo).toBe(true);
      expect(view.label.toLowerCase()).toContain("demo");
      expect(view.tooltip.toLowerCase()).not.toMatch(/settled/i);
    });

    it("uses failed-flavored copy when unavailable for failed evidence", () => {
      const view = deriveFreshness(build({ kind: "failed" }));
      expect(view.state).toBe("unavailable");
      expect(view.label.toLowerCase()).toContain("failed");
      expect(view.label.toLowerCase()).not.toMatch(/demo/);
    });
  });

  describe("fresh proof", () => {
    it("returns fresh state for proof captured seconds ago", () => {
      const view = deriveFreshness(
        build({
          kind: "settled",
          capturedAt: new Date(NOW - 12_000).toISOString()
        })
      );
      expect(view.state).toBe("fresh");
      expect(view.ageMs).toBe(12_000);
      expect(view.label).toContain("12s ago");
      expect(view.isDemo).toBe(false);
      expect(view.tooltip).toMatch(/recent/i);
    });

    it("disambiguates verified and settled copy by kind", () => {
      const verifiedView = deriveFreshness(
        build({ kind: "verified", capturedAt: new Date(NOW - 4_000).toISOString() })
      );
      const settledView = deriveFreshness(
        build({ kind: "settled", capturedAt: new Date(NOW - 4_000).toISOString() })
      );
      expect(verifiedView.label.toLowerCase()).toContain("verified proof");
      expect(settledView.label.toLowerCase()).toContain("settled proof");
    });

    it("returns fresh state at the threshold boundary (just inside)", () => {
      const view = deriveFreshness(
        build({
          kind: "verified",
          capturedAt: new Date(NOW - (DEFAULT_STALE_THRESHOLD_MS - 1)).toISOString()
        })
      );
      expect(view.state).toBe("fresh");
    });

    it("shows demo-flavored label even when fresh", () => {
      const view = deriveFreshness(
        build({
          kind: "demo",
          capturedAt: new Date(NOW - 8_000).toISOString()
        })
      );
      expect(view.state).toBe("fresh");
      expect(view.isDemo).toBe(true);
      expect(view.label.toLowerCase()).toContain("demo");
      expect(view.tooltip.toLowerCase()).not.toMatch(/settled/i);
    });

    it("does not imply settlement when fresh on failed evidence", () => {
      const view = deriveFreshness(
        build({ kind: "failed", capturedAt: new Date(NOW - 4_000).toISOString() })
      );
      expect(view.state).toBe("fresh");
      expect(view.label.toLowerCase()).toContain("failed");
      expect(view.tooltip.toLowerCase()).not.toMatch(/recent paid execution/);
      expect(view.tooltip.toLowerCase()).toContain("freshness does not imply");
    });
  });

  describe("stale proof", () => {
    it("returns stale state when age exceeds the threshold", () => {
      const view = deriveFreshness(
        build({
          kind: "settled",
          capturedAt: new Date(NOW - minutes(6)).toISOString()
        })
      );
      expect(view.state).toBe("stale");
      expect(view.ageMs).toBe(minutes(6));
      expect(view.label).toContain("6m ago");
      expect(view.label.toLowerCase()).toContain("stale settled proof");
    });

    it("returns stale state at the threshold boundary (just outside)", () => {
      const view = deriveFreshness(
        build({
          kind: "verified",
          capturedAt: new Date(NOW - (DEFAULT_STALE_THRESHOLD_MS + 1)).toISOString()
        })
      );
      expect(view.state).toBe("stale");
    });

    it("includes demo qualifier on stale demo evidence", () => {
      const view = deriveFreshness(
        build({
          kind: "demo",
          capturedAt: new Date(NOW - minutes(7)).toISOString()
        })
      );
      expect(view.state).toBe("stale");
      expect(view.isDemo).toBe(true);
      expect(view.label.toLowerCase()).toContain("demo");
      expect(view.tooltip.toLowerCase()).not.toMatch(/settled/i);
    });

    it("supports a configurable threshold without changing the default", () => {
      const view = deriveFreshness(
        build({
          kind: "verified",
          capturedAt: new Date(NOW - minutes(2)).toISOString(),
          staleThresholdMs: 30_000
        })
      );
      expect(view.state).toBe("stale");
      expect(view.ageMs).toBe(minutes(2));
    });
  });

  describe("non-positive ages", () => {
    it("treats future timestamps at zero or positive distance as fresh", () => {
      const view = deriveFreshness(
        build({
          kind: "settled",
          capturedAt: new Date(NOW + 5_000).toISOString()
        })
      );
      expect(view.state).toBe("fresh");
      expect(view.ageMs).toBe(0);
    });
  });
});
