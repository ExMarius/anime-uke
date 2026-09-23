#!/usr/bin/env bash
# Ruleaza toate suitele locale pe baze de date curate.
#
#   ./test.sh          scripts-health + e2e + dom-smoke + theme-cache + top-cache +
#                      counters + theme-flow + pixel-teme + plafoane
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

# Ucide intreg subarborele unui PID (dev.sh -> node wrangler -> workerd).
# Singurul kill pe PID lasa orfani: node respawn-uiasca workerd, iar
# workerd ramane sa tina 8788 — simptome: „no such table", DO-uri moarte.
kill_tree() {
  local root="$1"
  [ -z "$root" ] && return 0
  local all children next c
  all="$root"
  children="$(pgrep -P "$root" 2>/dev/null || true)"
  while [ -n "${children// /}" ]; do
    all="$all $children"
    next=""
    for c in $children; do next="$next $(pgrep -P "$c" 2>/dev/null || true)"; done
    children="$(echo $next | xargs)"
  done
  # shellcheck disable=SC2086
  kill -9 $all 2>/dev/null || true
}

# Elibereaza portul testelor: ucide orice wrangler/workerd ramas in urma
# run-urilor anterioare (supervizorul node respawn-uiasca workerd daca
# ucizi doar workerd, de aceea le oprim pe toate).
free_port() {
  local i
  # In script e sigor sa folosim literale: cmdline-ul suitei e „bash ./test.sh",
  # textul pattern-urilor NU apare in el. (Inline prin bash -c s-ar auto-ucide!)
  # Ordinea e critica: intai supervizorii node wrangler (ei respawn-uiesc
  # workerd), apoi workerd; repetam pana portul e efectiv liber.
  for i in 1 2 3 4 5 6 7 8; do
    if ! ss -tln 2>/dev/null | grep -q ":$PORT "; then return 0; fi
    pkill -9 -f 'wrangler-dist/cli.js' 2>/dev/null || true
    sleep 1
    pkill -9 -f 'workerd serve' 2>/dev/null || true
    sleep 1
  done
  if ss -tln 2>/dev/null | grep -q ":$PORT "; then
    echo "! portul $PORT a ramas ocupat — renunt, ca sa nu testez un server mort" >&2
    return 1
  fi
}

start_server() {
  # $@ = variabile de mediu pentru dev.sh (ex. LIMIT_USERS=3) — `env` le
  # seteaza in procesul copil, ca wrangler sa le vada ca bindinguri.
  free_port
  echo "── pornesc dev.sh $* ──"
  env "$@" ./dev.sh > "$LOG" 2>&1 &
  DEV_PID=$!
  for _ in $(seq 1 90); do
    grep -qE "Ready on|updated and ready" "$LOG" 2>/dev/null && break
    kill -0 "$DEV_PID" 2>/dev/null || { echo "dev.sh a murit:"; tail -20 "$LOG"; exit 1; }
    sleep 1
  done
  grep -qE "Ready on|updated and ready" "$LOG" || { echo "dev.sh nu a pornit in 90s:"; tail -20 "$LOG"; exit 1; }
}

stop_server() {
  if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    pkill -P "$DEV_PID" 2>/dev/null
    kill "$DEV_PID" 2>/dev/null
    wait "$DEV_PID" 2>/dev/null
    DEV_PID=""
  fi
}

# ---------------------------------------------------------------------
# Faza 0: sănătatea scripturilor. Rulează INAINTE de a porni serverul —
# prinde o eroare de sintaxă în cmd.sh/deploy.sh în două secunde, nu după
# un ciclu întreg de deploy picat pe runnerul GitHub.
# ---------------------------------------------------------------------
echo "════════ scripts-health (sintaxa scripturilor, fara server) ════════"
node tests/scripts-health.mjs > /tmp/scripts.log 2>&1
SCRIPTS_RC=$?
tail -4 /tmp/scripts.log
[ "$SCRIPTS_RC" -eq 0 ] || { echo "!! scripts-health a picat:"; cat /tmp/scripts.log; exit 1; }

echo "── reset baza locala ──"
rm -rf .wrangler/state
# TOP_CACHE_MINUTES=0: topul săptămânal se recalculează la fiecare cerere, ca
# suita să vadă imediat progresul scris de teste (în producție cache-ul e de o
# oră; comportamentul lui e testat separat, în tests/top-cache.mjs).
start_server TOP_CACHE_MINUTES=0

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

echo
echo "════════ theme-cache (tema instant, fara server) ════════"
node tests/theme-cache.mjs > /tmp/theme.log 2>&1
THEME_RC=$?
tail -10 /tmp/theme.log
if [ $THEME_RC -ne 0 ]; then
  echo "!! theme-cache s-a oprit cu codul $THEME_RC — ultimele erori:"
  grep -nE "Error|at .*\\.mjs|Cannot|is not" /tmp/theme.log | tail -12
fi
[ "$THEME_RC" -eq 0 ] || RC=1

echo
echo "════════ top-cache (cache top săptămânal, fara server) ════════"
node tests/top-cache.mjs > /tmp/topcache.log 2>&1
TOPC_RC=$?
tail -6 /tmp/topcache.log
if [ $TOPC_RC -ne 0 ]; then
  echo "!! top-cache s-a oprit cu codul $TOPC_RC — ultimele erori:"
  grep -nE "Error|at .*\.mjs|Cannot|is not" /tmp/topcache.log | tail -12
fi
[ "$TOPC_RC" -eq 0 ] || RC=1

echo
echo "════════ counters (contoare denormalizate, fara server) ════════"
node tests/counters.mjs > /tmp/counters.log 2>&1
COUNTERS_RC=$?
tail -6 /tmp/counters.log
if [ $COUNTERS_RC -ne 0 ]; then
  echo "!! counters s-a oprit cu codul $COUNTERS_RC — ultimele erori:"
  grep -nE "Error|at .*\.mjs|Cannot|is not" /tmp/counters.log | tail -12
fi
[ "$COUNTERS_RC" -eq 0 ] || RC=1

echo
echo "════════ theme-flow (flux tema animata, pagina reala) ════════"
node tests/theme-flow.mjs > /tmp/flow.log 2>&1
FLOW_RC=$?
tail -8 /tmp/flow.log
if [ $FLOW_RC -ne 0 ]; then
  echo "!! theme-flow s-a oprit cu codul $FLOW_RC — ultimele erori:"
  grep -nE "Error|at .*\\.mjs|Cannot|is not" /tmp/flow.log | tail -12
fi
[ "$FLOW_RC" -eq 0 ] || RC=1

echo
echo "════════ pixel-teme (particule reale pe canvas) ════════"
node tests/pixel-teme.mjs > /tmp/pixel.log 2>&1
PIXEL_RC=$?
tail -12 /tmp/pixel.log
if [ $PIXEL_RC -ne 0 ]; then
  echo "!! pixel-teme s-a oprit cu codul $PIXEL_RC — ultimele erori:"
  grep -nE "Error|at .*\\.mjs|Cannot|is not" /tmp/pixel.log | tail -12
fi
[ "$PIXEL_RC" -eq 0 ] || RC=1

# ---------------------------------------------------------------------
# Faza 3: plafoanele buget-0. Repornim serverul pe o baza curata cu tavane
# mici (4 conturi, 2 serii) ca sa simulam „comunitatea plina" fara sa
# inseram 1000 de randuri.
# ---------------------------------------------------------------------
stop_server
echo
echo "── reset baza locala (faza plafoane) ──"
rm -rf .wrangler/state
# TOP_CACHE_MINUTES=0: topul săptămânal se recalculează la fiecare cerere, ca
# suita să vadă imediat progresul scris de teste (în producție cache-ul e de o
# oră; comportamentul lui e testat separat, în tests/top-cache.mjs).
start_server TOP_CACHE_MINUTES=0 LIMIT_USERS=4 LIMIT_SERIES=2 CANONICAL_ORIGIN=https://anime-uke.test

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
