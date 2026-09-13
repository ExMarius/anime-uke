#!/usr/bin/env bash
# =====================================================================
# deploy.sh — deploy complet anime-uke pe Cloudflare, buget 0.
#
# Ordine obligatorie (DO-urile trebuie sa existe INAINTE ca Pages sa
# poata lega bindingurile cu script_name):
#
#   1. D1            -> creeaza baza de date daca nu exista
#   2. Schema        -> aplica migrarile SQL pe D1 (remote)
#   3. Worker DO     -> publica ChatDO / RateLimitDO / StatsDO
#   4. Pages         -> publica frontendul + _worker.js (Advanced Mode)
#   5. JWT_SECRET    -> seteaza secretul pe proiectul Pages
#
# Necesita:
#   export CLOUDFLARE_API_TOKEN=...
#   export CLOUDFLARE_ACCOUNT_ID=...
# Permisiuni token: D1 Edit, Cloudflare Pages Edit, Workers Scripts Edit,
#                   Account Settings Read.
# =====================================================================
set -euo pipefail

cd "$(dirname "$0")"

PROJECT="anime-uke"
WORKER="anime-uke-do"
DB_NAME="anime-db"
DB_BINDING="DB"

: "${CLOUDFLARE_API_TOKEN:?Lipseste CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?Lipseste CLOUDFLARE_ACCOUNT_ID}"

# Cale ABSOLUTA: deploy.sh face `cd worker-do`, deci o cale relativa s-ar strica.
WRANGLER="npx wrangler"
[ -x "$PWD/node_modules/.bin/wrangler" ] && WRANGLER="$PWD/node_modules/.bin/wrangler"

step() { printf '\n\033[1;35m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[0;32m✓\033[0m %s\n' "$1"; }
die()  { printf '    \033[0;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------
step "1/5  Baza de date D1"
DB_UUID="$(curl -sS "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);if(!j.success)process.exit(2);const m=(j.result||[]).find(x=>x.name===process.argv[1]);console.log(m?m.uuid:"")})' "$DB_NAME" || true)"

if [ -z "$DB_UUID" ]; then
  $WRANGLER d1 create "$DB_NAME" >/tmp/d1out.txt 2>&1 || { cat /tmp/d1out.txt; die "nu am putut crea D1"; }
  DB_UUID="$(grep -oE 'database_id = "[0-9a-f-]{36}"' /tmp/d1out.txt | head -1 | grep -oE '[0-9a-f-]{36}')"
  [ -n "$DB_UUID" ] || die "nu am gasit UUID-ul bazei in iesirea wrangler"
  ok "creata: $DB_NAME ($DB_UUID)"
else
  ok "exista deja: $DB_NAME ($DB_UUID)"
fi

# injecteaza UUID-ul in toate configuratiile
for f in wrangler.prod.toml wrangler.toml wrangler.local.toml worker-do/wrangler.toml; do
  [ -f "$f" ] && sed -i "s/database_id = \"[^\"]*\"/database_id = \"$DB_UUID\"/" "$f"
done
ok "database_id injectat in toate configuratiile"

# `dev.sh` inlocuieste wrangler.toml cu configuratia LOCALA cat timp ruleaza
# serverul de dezvoltare. Daca am deploya in acel moment, Pages ar primi
# bindinguri DO fara script_name si ar respinge configul. Impunem aici
# sablonul canonic de productie, indiferent de starea lasata de dev.sh.
if [ -f wrangler.prod.toml ]; then
  cp -f wrangler.prod.toml wrangler.toml
  rm -f .wrangler.toml.prod.bak
  ok "wrangler.toml = configuratie de productie"
fi
grep -q 'script_name' wrangler.toml || die "wrangler.toml nu contine script_name — configuratie de productie invalida"

# ---------------------------------------------------------------------
step "2/5  Schema D1 (remote)"
$WRANGLER d1 migrations apply "$DB_BINDING" --remote >/tmp/mig.txt 2>&1 || { cat /tmp/mig.txt; die "migrari esuate"; }
grep -q 'No migrations to apply' /tmp/mig.txt && ok "deja aplicata" || ok "migrari aplicate"

# ---------------------------------------------------------------------
step "3/5  Worker Durable Objects: $WORKER"
set +e
( cd worker-do && $WRANGLER deploy >/tmp/wdo.txt 2>&1 )
RC=$?
set -e
# wrangler intoarce non-zero daca nu poate citi subdomeniul workers.dev,
# desi uploadul a reusit. Verificam succesul real dupa "Uploaded".
if grep -q "Uploaded $WORKER\|Current Version ID" /tmp/wdo.txt; then
  ok "publicat: $WORKER ($(grep -oE 'Total Upload: [^ ]*' /tmp/wdo.txt | head -1))"
elif [ "$RC" -eq 0 ]; then
  ok "publicat: $WORKER"
else
  cat /tmp/wdo.txt; die "deploy Worker DO esuat"
fi

# ---------------------------------------------------------------------
step "4/5  Cloudflare Pages: $PROJECT"
# Versionare assete: browserele cu cache vechi primeau JS-ul de dinainte
# de deploy („butonul nu merge” dupa fiecare release). Fiecare HTML primeste
# ?v=<git hash>; dupa deploy readucem fisierele la forma din repo.
BUILD_V="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
sed -i -E 's#(/assets/(css|js)/[A-Za-z0-9_.-]+\.(css|js))(\?v=[A-Za-z0-9_.-]+)?#\1?v='"${BUILD_V}"'#g' public/*.html public/admin/*.html \
  || die "versionarea assetelor a esuat (sed)"
grep -q "?v=${BUILD_V}" public/index.html || die "index.html nu a primit ?v=${BUILD_V}"
ok "assete versionate ?v=${BUILD_V}"
$WRANGLER pages deploy --project-name="$PROJECT" --branch=main --commit-dirty=true >/tmp/pages.txt 2>&1 \
  || { cat /tmp/pages.txt; die "deploy Pages esuat"; }
DEPLOY_URL="$(grep -oE 'https://[a-z0-9.-]*\.pages\.dev' /tmp/pages.txt | head -1 || true)"
ok "publicat: ${DEPLOY_URL:-vezi /tmp/pages.txt}"
git checkout -- public/*.html public/admin/*.html 2>/dev/null || true

# ---------------------------------------------------------------------
step "5/5  JWT_SECRET"
# Il generam DOAR la primul deploy. Inainte regeneram la fiecare publicare,
# ceea ce invalida toate sesiunile: orice deploy scotea toti utilizatorii
# afara. Acum ca exista conturi reale, asta ar fi fost deranjant saptamanal.
# Valoarea unui secret Pages nu poate fi citita (doar scrisa), dar
# `secret list` ii arata numele — suficient ca sa stim daca exista deja.
if $WRANGLER pages secret list --project-name="$PROJECT" 2>/dev/null | grep -q 'JWT_SECRET'; then
  ok "secretul exista deja — il pastrez, sesiunile raman valide"
elif printf '%s' "$(openssl rand -hex 32)" | $WRANGLER pages secret put JWT_SECRET --project-name="$PROJECT" >/tmp/sec.txt 2>&1; then
  ok "secret setat (valoare generata aleator, nepublicata)"
else
  cat /tmp/sec.txt
  echo "    Seteaza manual:  npx wrangler pages secret put JWT_SECRET --project-name=$PROJECT"
fi

printf '\n\033[1;32mGATA.\033[0m  Site: https://%s.pages.dev\n' "$PROJECT"
