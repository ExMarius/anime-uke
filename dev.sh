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

cp wrangler.local.toml wrangler.toml
echo "  (folosesc configuratia locala cu DO inline)"

PORT="${PORT:-8788}"
W="npx wrangler"
[ -x ./node_modules/.bin/wrangler ] && W="./node_modules/.bin/wrangler"

# Aplicam migrațiile inainte de pornire. Fara pasul asta, primul `dev.sh`
# pe un workspace proaspat (sau dupa `rm -rf .wrangler/state`) ridica
# serverul cu o baza goala si fiecare request pica cu „no such table: users".
# E idempotent: wrangler tine evidenta migrațiilor aplicate in d1_migrations.
if [ -z "${SKIP_MIGRATIONS:-}" ]; then
  echo "  (aplic migrarile locale)"
  $W d1 migrations apply DB --local >/dev/null 2>&1 || {
    echo "  ! nu am putut aplica migrarile; pornesc oricum" >&2
  }
fi

# NU folosim `exec`: ar inlocui shell-ul si capcana EXIT n-ar mai rula,
# lasand wrangler.toml pe configuratia locala (adica deploy-ul urmator
# ar publica bindinguri DO gresite).
#
# Plafoanele buget-0 (LIMIT_USERS / LIMIT_SERIES) si modul de inregistrare
# (REGISTRATION_MODE) se pot suprascrie din mediu pentru faza de teste care
# simuleaza o comunitate plina pe invitație. In productie variabilele nu
# exista: tavan 1000 si înregistrare deschisa.
set +e
BIND=()
[ -n "${LIMIT_USERS:-}" ] && BIND+=(--binding "LIMIT_USERS=$LIMIT_USERS")
[ -n "${LIMIT_SERIES:-}" ] && BIND+=(--binding "LIMIT_SERIES=$LIMIT_SERIES")
[ -n "${REGISTRATION_MODE:-}" ] && BIND+=(--binding "REGISTRATION_MODE=$REGISTRATION_MODE")
$W pages dev --port="$PORT" --ip=0.0.0.0 ${BIND[@]+"${BIND[@]}"}
RC=$?
set -e
exit $RC
