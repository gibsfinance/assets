#!/usr/bin/env bash
# Run each provider one at a time and verify it exits cleanly.
# Usage:
#   ./test-provider-exits.sh              # all providers
#   ./test-provider-exits.sh routescan    # specific providers
#   PARALLEL=4 ./test-provider-exits.sh   # run 4 at a time
#   TIMESTAMPS=0 ./test-provider-exits.sh # disable timestamps

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

TSX="../../node_modules/.bin/tsx"
timestamps="${TIMESTAMPS:-1}"

if [ ! -x "$TSX" ]; then
  echo "tsx not found at $TSX"
  exit 1
fi

log() {
  if [ "$timestamps" -eq 1 ]; then
    printf "[%s] %s\n" "$(date '+%H:%M:%S')" "$*"
  else
    echo "$*"
  fi
}

# All registered providers (must match keys in src/collect/collectables.ts)
all_providers=(
  dexscreener countries routescan pulsechain trustwallet
  uniswap-tokenlists kleros gibs piteas pulsex balancer
  midgard internetmoney phux pls369 smoldapp levinswap
  honeyswap pancake quickswap roll scroll set omnibridge
  dfyn coingecko 9mm uma baofinance compound optimism
  pumptires etherscan
)

if [ $# -gt 0 ]; then
  providers=("$@")
else
  providers=("${all_providers[@]}")
fi
parallel="${PARALLEL:-1}"
total=${#providers[@]}
passed=0
failed=0
results=()

run_one() {
  local p="$1"
  log "▶ ${p}  starting..."
  local start=$SECONDS
  DISABLE_TERMINAL=1 "$TSX" src/bin/collect.ts --providers="$p" --logger=raw >/dev/null 2>&1
  local code=$?
  local dur=$((SECONDS - start))
  if [ $code -eq 0 ]; then
    log "✅ ${p}  ${dur}s"
    results+=("✅ ${p}  ${dur}s")
    passed=$((passed + 1))
  else
    log "❌ ${p}  ${dur}s  exit=$code"
    results+=("❌ ${p}  ${dur}s  exit=$code")
    failed=$((failed + 1))
  fi
}

log "Provider Exit Test — ${total} providers, parallelism=${parallel}"
log "─────────────────────────────────────────────"

if [ "$parallel" -eq 1 ]; then
  for p in "${providers[@]}"; do
    run_one "$p"
  done
else
  # Run in batches
  for ((i=0; i<total; i+=parallel)); do
    batch=("${providers[@]:i:parallel}")
    for p in "${batch[@]}"; do
      run_one "$p" &
    done
    wait
  done
fi

log ""
log "═════════════════════════════════════════════"
log "Results: ${passed}/${total} passed, ${failed} failed"
log "═════════════════════════════════════════════"

if [ "$failed" -gt 0 ]; then
  log ""
  log "Failed:"
  for r in "${results[@]}"; do
    if [[ "$r" == ❌* ]]; then
      log "  $r"
    fi
  done
  exit 1
fi
