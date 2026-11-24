#!/usr/bin/env bash
# scripts/generate-demo-transcript.sh
#
# Generates a sanitized, deterministic demo transcript for Query402.
# Calls transcript.ts (NOT demo.ts — that is the console runner).
#
# MODE 1 — API already running:
#   DEMO_MODE=true ./scripts/generate-demo-transcript.sh
#
# MODE 2 — Fully automated (starts + stops API):
#   DEMO_MODE=true CI_OFFLINE=true ./scripts/generate-demo-transcript.sh

set -euo pipefail

DEMO_MODE="${DEMO_MODE:-true}"
CI_OFFLINE="${CI_OFFLINE:-false}"
API_BASE="${API_BASE_URL:-http://localhost:3001}"
API_PID=""

green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }

if [[ "$DEMO_MODE" != "true" ]]; then
  red "ERROR: DEMO_MODE must be 'true'."
  exit 1
fi

yellow "▶ Query402 demo transcript generator"
echo   "  DEMO_MODE  : $DEMO_MODE"
echo   "  API_BASE   : $API_BASE"
echo   "  CI_OFFLINE : $CI_OFFLINE"
echo   ""

if [[ "$CI_OFFLINE" == "true" ]]; then
  yellow "  Starting API in background…"
  DEMO_MODE=true PORT_API=3001 NODE_ENV=test \
    npx --workspace @query402/api ts-node src/index.ts &
  API_PID=$!

  echo -n "  Waiting for /health"
  for i in $(seq 1 30); do
    if curl -sf "$API_BASE/health" > /dev/null 2>&1; then echo " ✓"; break; fi
    echo -n "."; sleep 0.5
  done

  if ! curl -sf "$API_BASE/health" > /dev/null 2>&1; then
    red "  API did not become ready."
    kill "$API_PID" 2>/dev/null || true
    exit 1
  fi
fi

cleanup() {
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT

yellow "  Running transcript.ts…"
DEMO_MODE=true API_BASE_URL="$API_BASE" \
  npm run demo:transcript --workspace @query402/agent-client

yellow "  Scanning for accidental secrets…"
node scripts/check-payment-leaks.mjs transcript/

green "  ✓ No secrets detected."
echo  ""
green "✅ Transcript ready in ./transcript/"