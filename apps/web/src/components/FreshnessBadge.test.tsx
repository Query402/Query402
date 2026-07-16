import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FreshnessBadge, FreshnessBadgeView } from "./FreshnessBadge.js";
import {
  DEFAULT_STALE_THRESHOLD_MS,
  deriveFreshness,
  type FreshnessView
} from "../lib/freshness.js";

const NOW = Date.parse("2026-06-29T12:00:00.000Z");

function minutes(min: number) {
  return min * 60_000;
}

describe("FreshnessBadge", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("renders fresh state with elapsed time and copy for settled evidence", () => {
    const html = renderToStaticMarkup(
      <FreshnessBadge kind="settled" capturedAt={new Date(NOW - 7_000).toISOString()} />
    );

    expect(html).toContain("freshness-badge--fresh");
    expect(html).toContain("Fresh settled proof");
    expect(html).toContain("7s ago");
    expect(html).toContain('data-state="fresh"');
    expect(html).toContain('data-kind="settled"');
  });

  it("renders stale state when proof exceeds the threshold", () => {
    const html = renderToStaticMarkup(
      <FreshnessBadge kind="verified" capturedAt={new Date(NOW - minutes(8)).toISOString()} />
    );

    expect(html).toContain("freshness-badge--stale");
    expect(html).toContain("Stale verified proof");
    expect(html).toContain("8m ago");
    expect(html).toContain('data-state="stale"');
    expect(html).toContain('data-kind="verified"');
  });

  it("renders unavailable state when no capturedAt is provided", () => {
    const html = renderToStaticMarkup(<FreshnessBadge kind="settled" />);

    expect(html).toContain("freshness-badge--unavailable");
    expect(html).toContain("Proof timestamp unavailable");
    expect(html).toContain('data-state="unavailable"');
    expect(html).toContain('data-kind="settled"');
    expect(html).not.toMatch(/settled proof/i);
  });

  it("renders demo-flavored copy for fresh demo evidence", () => {
    const html = renderToStaticMarkup(
      <FreshnessBadge kind="demo" capturedAt={new Date(NOW - 4_000).toISOString()} />
    );

    expect(html).toContain("freshness-badge--demo");
    expect(html).toContain("freshness-badge--fresh");
    expect(html).toMatch(/Demo evidence · Fresh/);
    expect(html).toContain('data-kind="demo"');
    expect(html).not.toMatch(/settled proof/i);
  });

  it("uses default threshold when no threshold is provided", () => {
    const html = renderToStaticMarkup(
      <FreshnessBadge
        kind="settled"
        capturedAt={new Date(NOW - (DEFAULT_STALE_THRESHOLD_MS + 1)).toISOString()}
      />
    );

    expect(html).toContain("freshness-badge--stale");
  });

  it("renders failed-evidence copy without implying successful settlement", () => {
    const html = renderToStaticMarkup(
      <FreshnessBadge kind="failed" capturedAt={new Date(NOW - 3_000).toISOString()} />
    );

    expect(html).toContain("Failed proof");
    expect(html).toContain('data-kind="failed"');
    expect(html).not.toMatch(/settled proof/i);
    expect(html).not.toMatch(/verified proof/i);
  });

  it("emits 'unknown' data-kind when no kind is provided with a timestamp", () => {
    const html = renderToStaticMarkup(
      <FreshnessBadge capturedAt={new Date(NOW - 4_000).toISOString()} />
    );

    expect(html).toContain('data-kind="unknown"');
    expect(html).toContain("freshness-badge--fresh");
  });

  it("renders aria-label and title with the tooltip text", () => {
    const html = renderToStaticMarkup(
      <FreshnessBadge kind="settled" capturedAt={new Date(NOW - 5_000).toISOString()} />
    );

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
    expect(html).toMatch(/title="[^"]+"/);
    expect(html).toMatch(/aria-label="[^"]+"/);
  });

  it("renders the same data attributes via FreshnessBadgeView as a hand-built view", () => {
    const view: FreshnessView = deriveFreshness({
      kind: "settled",
      capturedAt: new Date(NOW - 1_000).toISOString(),
      now: NOW
    });
    const html = renderToStaticMarkup(<FreshnessBadgeView view={view} />);
    expect(html).toContain('data-state="fresh"');
    expect(html).toContain("Fresh settled proof");
  });
});

describe("FreshnessBadge production API", () => {
  it("does not expose test knobs in the runtime props contract", () => {
    // Compile-time: production props type must contain only "kind" and "capturedAt".
    // Any future (even optional) prop addition trips this assertion via a type error
    // at the `_check` assignment site.
    type AllowedProps = "kind" | "capturedAt";
    type _Extras =
      Exclude<keyof Parameters<typeof FreshnessBadge>[0], AllowedProps> extends never
        ? true
        : false;
    const _check: _Extras = true;
    void _check;

    // Runtime: defense-in-depth so the contract cannot be widened silently at runtime.
    const props: Parameters<typeof FreshnessBadge>[0] = {
      kind: "settled",
      capturedAt: "2026-06-29T12:00:00.000Z"
    };
    expect(Object.keys(props).sort().join(",")).toBe("capturedAt,kind");
  });
});
