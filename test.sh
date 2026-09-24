#!/usr/bin/env bash
# Ruleaza toate suitele locale pe baze de date curate.
#
#   ./test.sh          scripts-health + greutate + e2e + dom-smoke (+ dom-smoke pe build) +
#                      theme-cache + top-cache +
#                      counters + chat-persist + chat-d1 + theme-flow + pixel-teme + plafoane
#
# Nu atinge productia: porneste dev.sh pe :8788 cu migrari locale si sterge
# .wrangler/state la inceput, ca bootstrap-ul (primul user devine admin)
# sa functioneze.
set -uo pipefail
cd "$(dirname "$0")"

PORT=8788
LOG=/tmp/anime-uke-dev.log
DEV_PID=""

# Copie de siguranta pentru wrangler.toml (fisier generat; vezi cleanup()).
[ -f wrangler.toml ] && cp -f wrangler.toml /tmp/anime-uke-wrangler-start.toml

cleanup() {
  if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill_tree "$DEV_PID"
    wait "$DEV_PID" 2>/dev/null
  fi
  # wrangler.toml e un fisier GENERAT (dev.sh il inlocuieste cat ruleaza,
  # deploy.sh il reface pentru productie). Il punem la loc exact cum era la
  # pornire, ca suita sa nu lase modificari in git diff.
  if [ -f /tmp/anime-uke-wrangler-start.toml ]; then
    cp -f /tmp/anime-uke-wrangler-start.toml wrangler.toml
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
  # Intai TERM: dev.sh are un trap pe EXIT care pune la loc wrangler.toml.
  # Cu -9 din prima, trap-ul nu mai apuca sa ruleze si fisierul rămâne
  # in varianta locala (murdareste git diff dupa fiecare rulare).
  # shellcheck disable=SC2086
  kill -TERM $all 2>/dev/null || true
  local i
  for i in 1 2 3 4 5 6; do
    kill -0 "$root" 2>/dev/null || break
    sleep 0.5
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
  # Linia „Ready" nu garanteaza ca ne raspunde NOUĂ instanta: daca un
  # workerd strain a furat portul, logul e verde si testele primesc
  # ECONNREFUSED/date straine. Deci verificam efectiv, cu un request.
  local ok=""
  for _ in $(seq 1 30); do
    if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/api/genres"; then ok=1; break; fi
    sleep 1
  done
  if [ -z "$ok" ]; then
    echo "! serverul nu raspunde pe /api/genres dupa 30s (log: $LOG):"
    tail -20 "$LOG"
    free_port
    exit 1
  fi
}

stop_server() {
  if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill_tree "$DEV_PID"
    wait "$DEV_PID" 2>/dev/null
    DEV_PID=""
  fi
  # Portul trebuie sa fie liber DUPA oprire: daca nu e, un supervizor
  # straina a supravietuit si faza urmatoare ar testa alt server.
  if ss -tln 2>/dev/null | grep -q ":$PORT "; then
    echo "! portul $PORT e inca ocupat dupa oprirea serverului — il eliberez"
    free_port
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

# ---------------------------------------------------------------------
# Faza 1: greutatea reala a paginilor (buget de viteza). Ruleaza pipeline-ul
# de deploy pe o copie a repo-ului: purge CSS -> minificare -> bundle cu
# splitting, apoi compara calea critica (HTML + CSS + JS eager) cu bugetele.
# Nu are nevoie de server si tine ~2 secunde — esecul aici inseamna ca o
# pagina a ingrasat-o (ex: chatul a intrat iar pe calea critica).
# ---------------------------------------------------------------------
echo "════════ greutate (buget de viteza, fara server) ════════"
node scripts/measure-weight.mjs --out=/tmp/auk-artefacte > /tmp/weight.log 2>&1
WEIGHT_RC=$?
tail -6 /tmp/weight.log
if [ "$WEIGHT_RC" -ne 0 ]; then
  echo "!! bugetul de greutate a fost depasit:"
  cat /tmp/weight.log
fi
GREUTATE_RC="$WEIGHT_RC"   # RC-ul final se compune dupa ce pornim serverul

echo "── reset baza locala ──"
rm -rf .wrangler/state
# TOP_CACHE_MINUTES=0: topul săptămânal se recalculează la fiecare cerere, ca
# suita să vadă imediat progresul scris de teste (în producție cache-ul e de o
# oră; comportamentul lui e testat separat, în tests/top-cache.mjs).
start_server TOP_CACHE_MINUTES=0

RC=0
[ "${GREUTATE_RC:-0}" -eq 0 ] || RC=1
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
echo "════════ dom-smoke pe artefactele de deploy (bundle + chunk-uri reale) ════════"
# Faza de greutate a construit deja exact ce se publica (--out a păstrat
# artefactele). Rulăm ACELEAȘI verificări de pagină pe cod minificat, cu
# importurile relative către chunk-uri: o rupere în graf (un chunk lipsă, un
# import mutat de minificator) se vede aici, nu în producție.
AUK_JS_DIR=/tmp/auk-artefacte/public/assets/js node tests/dom-smoke.mjs > /tmp/dom-build.log 2>&1
DOMB_RC=$?
tail -8 /tmp/dom-build.log
if [ $DOMB_RC -ne 0 ]; then
  echo "!! dom-smoke (build) s-a oprit cu codul $DOMB_RC — ultimele erori:"
  grep -nE "Error|at .*\.mjs|Cannot|is not" /tmp/dom-build.log | tail -12
fi
[ "$DOMB_RC" -eq 0 ] || RC=1

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
echo "════════ chat-persist (chatul supravietuieste evictiei DO, fara server) ════════"
node tests/chat-persist.mjs > /tmp/chatpersist.log 2>&1
CHATP_RC=$?
tail -6 /tmp/chatpersist.log
if [ $CHATP_RC -ne 0 ]; then
  echo "!! chat-persist s-a oprit cu codul $CHATP_RC — ultimele erori:"
  grep -nE "Error|at .*\.mjs|Cannot|is not" /tmp/chatpersist.log | tail -12
fi
[ "$CHATP_RC" -eq 0 ] || RC=1

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
echo "════════ chat-d1 (mesajul ajunge in tabelul D1, fisier real) ════════"
node tests/chat-d1.mjs > /tmp/chatd1.log 2>&1
CHATD1_RC=$?
tail -8 /tmp/chatd1.log
if [ $CHATD1_RC -ne 0 ]; then
  echo "!! chat-d1 s-a oprit cu codul $CHATD1_RC — ultimele erori:"
  grep -nE "Error|at .*\.mjs|Cannot|is not" /tmp/chatd1.log | tail -12
fi
[ "$CHATD1_RC" -eq 0 ] || RC=1

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
