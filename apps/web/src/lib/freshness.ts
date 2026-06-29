import type { ProofKind } from "../types.js";

export type FreshnessState = "fresh" | "stale" | "unavailable";

export const DEFAULT_STALE_THRESHOLD_MS = 5 * 60 * 1000;

export interface DeriveFreshnessInput {
  kind?: ProofKind;
  capturedAt?: string | null;
  /** Injectable for deterministic tests. */
  now?: number;
  /** Injectable for tests; production uses DEFAULT_STALE_THRESHOLD_MS. */
  staleThresholdMs?: number;
}

export interface FreshnessView {
  state: FreshnessState;
  isDemo: boolean;
  kind: ProofKind | undefined;
  ageMs: number | null;
  label: string;
  tooltip: string;
}

const UNAVAILABLE_NON_DEMO = {
  label: "Proof timestamp unavailable",
  tooltip: "Payment proof metadata is unavailable for this execution."
};

const UNAVAILABLE_DEMO = {
  label: "Demo evidence · proof timestamp unavailable",
  tooltip: "Demo evidence does not constitute a settlement proof; timestamp metadata is missing."
};

const UNAVAILABLE_FAILED = {
  label: "Failed proof · timestamp unavailable",
  tooltip:
    "Payment attempt failed and proof metadata is unavailable; freshness does not imply settlement."
};

export function deriveFreshness(input: DeriveFreshnessInput): FreshnessView {
  const {
    kind,
    capturedAt,
    now = Date.now(),
    staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS
  } = input;

  const isDemo = kind === "demo";

  if (!capturedAt) {
    return unavailableView(kind);
  }

  const ts = Date.parse(capturedAt);
  if (Number.isNaN(ts)) {
    return unavailableView(kind);
  }

  const ageMs = Math.max(0, now - ts);
  if (ageMs <= staleThresholdMs) {
    return {
      state: "fresh",
      isDemo,
      kind,
      ageMs,
      label: chooseFreshLabel(kind, ageMs),
      tooltip: chooseFreshTooltip(kind)
    };
  }

  return {
    state: "stale",
    isDemo,
    kind,
    ageMs,
    label: chooseStaleLabel(kind, ageMs),
    tooltip: chooseStaleTooltip(kind)
  };
}

function unavailableView(kind: ProofKind | undefined): FreshnessView {
  let copy: { label: string; tooltip: string };
  let isDemo = false;
  if (kind === "demo") {
    copy = UNAVAILABLE_DEMO;
    isDemo = true;
  } else if (kind === "failed") {
    copy = UNAVAILABLE_FAILED;
  } else {
    copy = UNAVAILABLE_NON_DEMO;
  }
  return {
    state: "unavailable",
    isDemo,
    kind,
    ageMs: null,
    label: copy.label,
    tooltip: copy.tooltip
  };
}

function chooseFreshLabel(kind: ProofKind | undefined, ageMs: number) {
  const age = formatAge(ageMs);
  if (kind === "demo") return `Demo evidence · Fresh (${age})`;
  if (kind === "failed") return `Failed proof · captured (${age})`;
  if (kind === "settled") return `Fresh settled proof (${age})`;
  if (kind === "verified") return `Fresh verified proof (${age})`;
  return `Fresh proof (${age})`;
}

function chooseStaleLabel(kind: ProofKind | undefined, ageMs: number) {
  const age = formatAge(ageMs);
  if (kind === "demo") return `Demo evidence · Stale (${age})`;
  if (kind === "failed") return `Failed proof · stale (${age})`;
  if (kind === "settled") return `Stale settled proof (${age})`;
  if (kind === "verified") return `Stale verified proof (${age})`;
  return `Stale proof (${age})`;
}

function chooseFreshTooltip(kind: ProofKind | undefined) {
  if (kind === "demo") {
    return "Fresh demo marker captured locally. Demo evidence does not settle on-chain.";
  }
  if (kind === "failed") {
    return "Failed attempt captured at this time. Freshness does not imply successful settlement.";
  }
  return "Payment proof is recent and reflects the most recent paid execution.";
}

function chooseStaleTooltip(kind: ProofKind | undefined) {
  if (kind === "demo") {
    return "Demo marker is older than the freshness threshold. Demo evidence does not settle on-chain.";
  }
  if (kind === "failed") {
    return "Failed attempt timestamp is older than the freshness threshold; rate freshness as informational only.";
  }
  return "Payment proof is older than the freshness threshold; verify this reflects the latest execution.";
}

function formatAge(ageMs: number): string {
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
