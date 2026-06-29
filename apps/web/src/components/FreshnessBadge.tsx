import { deriveFreshness, type FreshnessView } from "../lib/freshness.js";
import type { ProofKind } from "../types.js";

export interface FreshnessBadgeProps {
  kind?: ProofKind;
  capturedAt?: string | null;
}

export function FreshnessBadge({ kind, capturedAt }: FreshnessBadgeProps) {
  const view = deriveFreshness({ kind, capturedAt });
  return <FreshnessBadgeView view={view} />;
}

export interface FreshnessBadgeViewProps {
  view: FreshnessView;
}

export function FreshnessBadgeView({ view }: FreshnessBadgeViewProps) {
  const className = [
    "freshness-badge",
    `freshness-badge--${view.state}`,
    view.kind ? `freshness-badge--kind-${view.kind}` : null,
    view.isDemo ? "freshness-badge--demo" : null
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={className}
      role="status"
      aria-live="polite"
      title={view.tooltip}
      aria-label={view.tooltip}
      data-state={view.state}
      data-kind={view.kind ?? "unknown"}
    >
      <span aria-hidden className="freshness-badge__dot" />
      <span className="freshness-badge__label">{view.label}</span>
    </span>
  );
}
