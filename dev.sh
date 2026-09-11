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

cp wrangler.local.toml wrangler.toml
echo "  (folosesc configuratia locala cu DO inline)"

PORT="${PORT:-8788}"
W="npx wrangler"
[ -x ./node_modules/.bin/wrangler ] && W="./node_modules/.bin/wrangler"

# NU folosim `exec`: ar inlocui shell-ul si capcana EXIT n-ar mai rula,
# lasand wrangler.toml pe configuratia locala (adica deploy-ul urmator
# ar publica bindinguri DO gresite).
set +e
$W pages dev --port="$PORT" --ip=0.0.0.0
RC=$?
set -e
exit $RC
