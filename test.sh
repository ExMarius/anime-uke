#!/usr/bin/env bash
# Ruleaza toate suitele locale pe baze de date curate.
#
#   ./test.sh          e2e (API) + dom-smoke (pagini in jsdom) + plafoane
#
# Nu atinge productia: porneste dev.sh pe :8788 cu migrari locale si sterge
# .wrangler/state la inceput, ca bootstrap-ul (primul user devine admin)
# sa functioneze.
set -uo pipefail
cd "$(dirname "$0")"

PORT=8788
LOG=/tmp/anime-uke-dev.log
DEV_PID=""

cleanup() {
  if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    pkill -P "$DEV_PID" 2>/dev/null
    kill "$DEV_PID" 2>/dev/null
    wait "$DEV_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

start_server() {
  # $@ = variabile de mediu pentru dev.sh (ex. LIMIT_USERS=3) — `env` le
  # seteaza in procesul copil, ca wrangler sa le vada ca bindinguri.
  echo "── pornesc dev.sh $* ──"
  env "$@" ./dev.sh > "$LOG" 2>&1 &
  DEV_PID=$!
  for _ in $(seq 1 90); do
    grep -q "Ready on" "$LOG" 2>/dev/null && break
    kill -0 "$DEV_PID" 2>/dev/null || { echo "dev.sh a murit:"; tail -20 "$LOG"; exit 1; }
    sleep 1
  done
  grep -q "Ready on" "$LOG" || { echo "dev.sh nu a pornit in 90s:"; tail -20 "$LOG"; exit 1; }
}

stop_server() {
  if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    pkill -P "$DEV_PID" 2>/dev/null
    kill "$DEV_PID" 2>/dev/null
    wait "$DEV_PID" 2>/dev/null
    DEV_PID=""
  fi
}

echo "── reset baza locala ──"
rm -rf .wrangler/state
start_server

RC=0
echo
echo "════════ e2e (API) ════════"
# Logul complet ramane pe disc: un crash la mijlocul suitei ar fi altfel
# invizibil, pentru ca tail arata doar ultimele randuri.
node tests/e2e.mjs > /tmp/e2e.log 2>&1
E2E_RC=$?
tail -8 /tmp/e2e.log
if [ $E2E_RC -ne 0 ]; then
  echo "!! e2e s-a oprit cu codul $E2E_RC — ultimele erori:"
  grep -nE "Error|error:|at .*\.mjs|Cannot|is not" /tmp/e2e.log | tail -12
fi
[ "$E2E_RC" -eq 0 ] || RC=1

echo
echo "════════ dom-smoke (pagini in jsdom) ════════"
node tests/dom-smoke.mjs > /tmp/dom.log 2>&1
DOM_RC=$?
tail -8 /tmp/dom.log
if [ $DOM_RC -ne 0 ]; then
  echo "!! dom-smoke s-a oprit cu codul $DOM_RC — ultimele erori:"
  grep -nE "Error|at .*\.mjs|Cannot|is not" /tmp/dom.log | tail -12
fi
[ "$DOM_RC" -eq 0 ] || RC=1

# ---------------------------------------------------------------------
# Faza 3: plafoanele buget-0. Repornim serverul pe o baza curata cu tavane
# mici (4 conturi, 2 serii) ca sa simulam „comunitatea plina" fara sa
# inseram 1000 de randuri.
# ---------------------------------------------------------------------
stop_server
echo
echo "── reset baza locala (faza plafoane) ──"
rm -rf .wrangler/state
start_server LIMIT_USERS=4 LIMIT_SERIES=2 CANONICAL_ORIGIN=https://anime-uke.test

echo
echo "════════ caps-e2e (plafoane buget-0) ════════"
node tests/caps-e2e.mjs > /tmp/caps.log 2>&1
CAPS_RC=$?
tail -12 /tmp/caps.log
if [ $CAPS_RC -ne 0 ]; then
  echo "!! caps-e2e s-a oprit cu codul $CAPS_RC — ultimele erori:"
  grep -nE "Error|at .*\.mjs|Cannot|is not" /tmp/caps.log | tail -12
fi
[ "$CAPS_RC" -eq 0 ] || RC=1

echo
[ "$RC" -eq 0 ] && echo "✅ Toate suitele au trecut" || echo "❌ Exista esecuri"
exit "$RC"
