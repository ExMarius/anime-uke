#!/usr/bin/env bash
# =====================================================================
# dev.sh — porneste dezvoltarea locala.
#
# Pages citeste DOAR `wrangler.toml` din radacina si nu accepta --config
# cu alta cale. Dar `wrangler.toml` este configuratia de PRODUCTIE, care
# trimite DO-urile la Worker-ul extern `anime-uke-do` prin script_name.
#
# Local vrem invers: DO-urile ruleaza inline in _worker.js (Advanced Mode)
# cu [[migrations]], ca sa nu fie nevoie de al doilea Worker pornit.
#
# Deci: acest script inlocuieste temporar wrangler.toml cu
# wrangler.local.toml, porneste serverul, si il pune la loc la iesire.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

restore() {
  # Restauram din SABLONUL CANONIC, nu dintr-un backup facut la pornire:
  # daca intre timp a rulat deploy.sh, backupul ar fi putut fi nevalid.
  if [ -f wrangler.prod.toml ]; then
    cp -f wrangler.prod.toml wrangler.toml
    rm -f .wrangler.toml.prod.bak
    echo "  (wrangler.toml restaurat din wrangler.prod.toml)"
  fi
}
trap restore EXIT INT TERM

if [ ! -f wrangler.local.toml ]; then
  echo "Lipseste wrangler.local.toml" >&2; exit 1
fi

# .dev.vars lipsa (workspace proaspat, .dev.vars e gitignore) inseamna
# JWT_SECRET gol => orice login/register pica cu „Imported HMAC key length
# (0)" -> 500. Generam un secret de dev la prima rulare, ca site-ul local
# sa functioneze imediat dupa clone, fara pas manual.
if [ ! -f .dev.vars ]; then
  printf 'JWT_SECRET=%s\n' "$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > .dev.vars
  echo "  (am generat .dev.vars cu JWT_SECRET random pentru dezvoltare)"
fi

# IMPORTANT: migrarile ruleaza INAINTE de a exista wrangler.toml in folder.
# Simplul fapt ca un wrangler.toml de tip Pages e prezent in cwd baga
# `d1 migrations apply` pe un cod de runtime cu bug (_cf_ALARM), chiar si
# cand ii dam --config cu un fisier minimal. Fara el, migrarile curg OK.
PORT="${PORT:-8788}"
W="npx wrangler"
[ -x ./node_modules/.bin/wrangler ] && W="./node_modules/.bin/wrangler"

if [ -z "${SKIP_MIGRATIONS:-}" ]; then
  echo "  (aplic migrarile locale)"
  # Stergem orice wrangler.toml ramas (ex. cel de productie restaurat de
  # trap-ul run-ului anterior) — prezenta lui declansa bugul de migrari.
  rm -f wrangler.toml
  $W d1 migrations apply DB --local --config wrangler.migrate.toml >/tmp/mig-dev.log 2>&1 || {
    echo "  ! nu am putut aplica migrarile; vezi /tmp/mig-dev.log" >&2
    tail -5 /tmp/mig-dev.log >&2 || true
  }
fi

cp wrangler.local.toml wrangler.toml
echo "  (folosesc configuratia locala cu DO inline)"

# NU folosim `exec`: ar inlocui shell-ul si capcana EXIT n-ar mai rula,
# lasand wrangler.toml pe configuratia locala (adica deploy-ul urmator
# ar publica bindinguri DO gresite).
#
# Plafoanele buget-0 (LIMIT_USERS / LIMIT_SERIES) se pot suprascrie din
# mediu pentru faza de teste care simuleaza o comunitate plina. In
# productie variabilele nu exista, deci tavanul ramane 1000.
set +e
# Fara telemetrie/check de versiune: la pana de retea apelurile catre
# Cloudflare pot criona procesul inainte sa inceapa sa asculte.
export WRANGLER_SEND_METRICS=false
export CI=true
export NO_UPDATE_NOTIFIER=1
BIND=()
[ -n "${LIMIT_USERS:-}" ] && BIND+=(--binding "LIMIT_USERS=$LIMIT_USERS")
[ -n "${LIMIT_SERIES:-}" ] && BIND+=(--binding "LIMIT_SERIES=$LIMIT_SERIES")
[ -n "${CANONICAL_ORIGIN:-}" ] && BIND+=(--binding "CANONICAL_ORIGIN=$CANONICAL_ORIGIN")
# 0 = topul săptămânal se recalculează la fiecare cerere (fără cache de o oră),
# ca dezvoltarea și testele să vadă imediat efectul unei vizionări.
[ -n "${TOP_CACHE_MINUTES:-}" ] && BIND+=(--binding "TOP_CACHE_MINUTES=$TOP_CACHE_MINUTES")
# 0 = „câți sunt online” se citește live din ChatDO. În producție bindingul
# lipsește, deci pulse.js ține contorul 60 s (o cerere DO pe minut per izolat,
# nu una pe fiecare /api/pulse). Testul de regresie „online ≥ 1” are nevoie de 0.
BIND+=(--binding "ONLINE_CACHE_MS=${ONLINE_CACHE_MS:-0}")
$W pages dev --port="$PORT" --ip=0.0.0.0 ${BIND[@]+"${BIND[@]}"}
RC=$?
set -e
exit $RC
