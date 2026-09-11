#!/usr/bin/env bash
# Ruleaza ambele suite locale pe o baza de date curata.
#
#   ./test.sh          e2e (API) + dom-smoke (pagini in jsdom)
#
# Nu atinge productia: porneste dev.sh pe :8788 cu migrari locale si sterge
# .wrangler/state la inceput, ca bootstrap-ul (primul user devine admin)
# sa functioneze.
set -uo pipefail
cd "$(dirname "$0")"

PORT=8788
LOG=/tmp/anime-uke-dev.log

cleanup() {
  if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    pkill -P "$DEV_PID" 2>/dev/null
    kill "$DEV_PID" 2>/dev/null
    wait "$DEV_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

echo "── reset baza locala ──"
rm -rf .wrangler/state

echo "── pornesc dev.sh ──"
./dev.sh > "$LOG" 2>&1 &
DEV_PID=$!
for _ in $(seq 1 90); do
  grep -q "Ready on" "$LOG" 2>/dev/null && break
  kill -0 "$DEV_PID" 2>/dev/null || { echo "dev.sh a murit:"; tail -20 "$LOG"; exit 1; }
  sleep 1
done
grep -q "Ready on" "$LOG" || { echo "dev.sh nu a pornit in 90s:"; tail -20 "$LOG"; exit 1; }

RC=0
echo
echo "════════ e2e (API) ════════"
node tests/e2e.mjs | tail -6
[ "${PIPESTATUS[0]}" -eq 0 ] || RC=1

echo
echo "════════ dom-smoke (pagini in jsdom) ════════"
node tests/dom-smoke.mjs | tail -6
[ "${PIPESTATUS[0]}" -eq 0 ] || RC=1

echo
[ "$RC" -eq 0 ] && echo "✅ Ambele suite au trecut" || echo "❌ Exista esecuri"
exit "$RC"
