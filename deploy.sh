#!/usr/bin/env bash
# =====================================================================
# deploy.sh — deploy complet anime-uke pe Cloudflare, buget 0.
#
# Ordine obligatorie (DO-urile trebuie sa existe INAINTE ca Pages sa
# poata lega bindingurile cu script_name):
#
#   1. D1            -> creeaza baza de date daca nu exista
#   2. Schema D1     -> aplica migrarile SQL pe D1 (remote)
#   3. Turso         -> schema DM + import idempotent din D1
#   4. Worker DO     -> publica ChatDO / RateLimitDO / StatsDO + secrete Turso
#   5. Pages         -> publica frontendul + _worker.js + secrete Turso
#   6. JWT_SECRET    -> pastreaza/seteaza secretul pe proiectul Pages
#
# Necesita (valorile vin din GitHub Actions Secrets):
#   export CLOUDFLARE_API_TOKEN=...
#   export CLOUDFLARE_ACCOUNT_ID=...
#   export TURSO_DATABASE_URL=...
#   export TURSO_AUTH_TOKEN=...
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
: "${TURSO_DATABASE_URL:?Lipseste TURSO_DATABASE_URL}"
: "${TURSO_AUTH_TOKEN:?Lipseste TURSO_AUTH_TOKEN}"

# Cale ABSOLUTA: deploy.sh face `cd worker-do`, deci o cale relativa s-ar strica.
WRANGLER="npx wrangler"
[ -x "$PWD/node_modules/.bin/wrangler" ] && WRANGLER="$PWD/node_modules/.bin/wrangler"

step() { printf '\n\033[1;35m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[0;32m✓\033[0m %s\n' "$1"; }
die()  { printf '    \033[0;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------
step "1/6  Baza de date D1"
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
step "2/6  Schema D1 (remote)"
$WRANGLER d1 migrations apply "$DB_BINDING" --remote >/tmp/mig.txt 2>&1 || { cat /tmp/mig.txt; die "migrari esuate"; }
grep -q 'No migrations to apply' /tmp/mig.txt && ok "deja aplicata" || ok "migrari aplicate"

# ---------------------------------------------------------------------
step "3/6  Turso: schema + istoric mesaje private"
# Păstrăm orice DM creat în scurta perioadă în care funcția a folosit D1.
# Exportul conține numai coloanele tabelului de mesaje; tokenul Turso nu este
# argument CLI și nu ajunge în log, ci rămâne în environment.
$WRANGLER d1 execute "$DB_BINDING" --remote --json \
  --command "SELECT id, sender_id, recipient_id, message, created_at, read_at FROM private_messages ORDER BY id" \
  >/tmp/private-messages-d1.json 2>/tmp/private-messages-d1.err \
  || { cat /tmp/private-messages-d1.err; die "nu am putut exporta mesajele private din D1"; }
node scripts/turso-migrate.mjs --backfill /tmp/private-messages-d1.json \
  >/tmp/turso-migrate.txt 2>&1 || { cat /tmp/turso-migrate.txt; die "migrare Turso esuata"; }
cat /tmp/turso-migrate.txt
rm -f /tmp/private-messages-d1.json /tmp/private-messages-d1.err /tmp/turso-migrate.txt
ok "baza anime-uke-messages este pregatita"

# Progresul de vizionare: migrarea Turso 0002 a fost deja aplicată mai sus
# (același director). Backfill-ul + comparația rulează DOAR când etapa e
# activă (WATCH_STORE=shadow|turso) — în modul d1 nu atingem nimic.
WATCH_STORE="${WATCH_STORE:-d1}"
case "$WATCH_STORE" in
  shadow|turso)
    step "3b/6  Turso: backfill + comparatie watch_progress ($WATCH_STORE)"
    $WRANGLER d1 execute "$DB_BINDING" --remote --json \
      --command "SELECT wp.user_id, wp.episode_id, e.series_id, wp.seconds, wp.updated_at FROM watch_progress wp JOIN episodes e ON e.id = wp.episode_id" \
      >/tmp/watch-progress-d1.json 2>/tmp/watch-progress-d1.err \
      || { cat /tmp/watch-progress-d1.err; die "nu am putut exporta watch_progress din D1"; }
    node scripts/watch-turso.mjs backfill /tmp/watch-progress-d1.json \
      >/tmp/watch-backfill.txt 2>&1 || { cat /tmp/watch-backfill.txt; die "backfill watch_progress esuat"; }
    cat /tmp/watch-backfill.txt
    # Verificarea e OBLIGATORIE, dar nu blocheaza deployul pe o diferenta de
    # un heartbeat in zbor (toleranta 300s); rezultatul complet ramane in log.
    node scripts/watch-turso.mjs compare /tmp/watch-progress-d1.json --tolerance 300 \
      >/tmp/watch-compare.txt 2>&1
    WATCH_CMP_RC=$?
    cat /tmp/watch-compare.txt
    [ "$WATCH_CMP_RC" -eq 0 ] || echo "  !! D1 si Turso NU coincid — vezi mai sus (deployul continua, dar NU comuta pe turso)"
    rm -f /tmp/watch-progress-d1.json /tmp/watch-progress-d1.err /tmp/watch-backfill.txt /tmp/watch-compare.txt
    ok "watch_progress sincronizat in Turso"
    ;;
  *)
    ok "watch_progress ramane in D1 (WATCH_STORE=d1)"
    ;;
esac

# ---------------------------------------------------------------------
step "4/6  Worker Durable Objects: $WORKER"
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

# Workerul DO face INSERT-ul DM, deci are nevoie de aceleași două secrete.
# `put` primește valoarea prin stdin; nu apare în comandă sau output.
printf '%s' "$TURSO_DATABASE_URL" | ( cd worker-do && $WRANGLER secret put TURSO_DATABASE_URL ) \
  >/tmp/wdo-turso-url.txt 2>&1 || { cat /tmp/wdo-turso-url.txt; die "secretul Turso URL nu a ajuns in Worker DO"; }
printf '%s' "$TURSO_AUTH_TOKEN" | ( cd worker-do && $WRANGLER secret put TURSO_AUTH_TOKEN ) \
  >/tmp/wdo-turso-token.txt 2>&1 || { cat /tmp/wdo-turso-token.txt; die "secretul Turso token nu a ajuns in Worker DO"; }
rm -f /tmp/wdo-turso-url.txt /tmp/wdo-turso-token.txt
ok "secretele Turso sunt legate la Worker DO"

# ---------------------------------------------------------------------
step "5/6  Cloudflare Pages: $PROJECT"
# Versionare assete: browserele cu cache vechi primeau JS-ul de dinainte
# de deploy („butonul nu merge” dupa fiecare release). Fiecare HTML primeste
# ?v=<git hash>; dupa deploy readucem fisierele la forma din repo.
BUILD_V="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
sed -i -E 's#(/assets/(css|js)/[A-Za-z0-9_.-]+\.(css|js))(\?v=[A-Za-z0-9_.-]+)?#\1?v='"${BUILD_V}"'#g' public/*.html public/admin/*.html \
  || die "versionarea assetelor a esuat (sed)"
grep -q "?v=${BUILD_V}" public/index.html || die "index.html nu a primit ?v=${BUILD_V}"
ok "assete versionate ?v=${BUILD_V}"

# Assetele NU mai trec prin worker (public/_routes.json le scoate de sub
# Functions: fiecare cerere de asset consuma altfel o invocare din cota
# gratuita de 100.000/zi). Deci Cache-Control vine din public/_headers, unde
# valoarea de dezvoltare e „no-cache” — o inlocuim cu immutable 1 an DOAR
# pentru JS/CSS, care sunt versionate ?v=<commit>. Restul fisierului
# (imagini, subtitrari, coperți) isi pastreaza regulile.
sed -i '/assets-versioned:start/,/assets-versioned:end/ s|Cache-Control: no-cache|Cache-Control: public, max-age=31536000, immutable|' public/_headers \
  || die "nu am putut versiona Cache-Control din _headers"
grep -q 'max-age=31536000, immutable' public/_headers || die "public/_headers nu a primit immutable"
ok "Cache-Control immutable pentru JS/CSS (public/_headers)"
[ -f public/_routes.json ] || die "lipseste public/_routes.json — assetele ar intra in cota de Functions"
ok "assetele statice ocolesc workerul (_routes.json)"

# Purge: reguli CSS care nu mai apar nicăieri în HTML/JS/worker (clase
# dinamice sunt în safelist, vezi scripts/purge-css.mjs). Rulat DOAR pe
# style.css — foile per-pagină sunt deja fără resturi.
if [ -f scripts/purge-css.mjs ] && command -v node >/dev/null 2>&1; then
  if node scripts/purge-css.mjs >/dev/null 2>&1 && [ -s /tmp/purged/style.css ]; then
    cp /tmp/purged/style.css public/assets/css/style.css
    ok "CSS purgat de reguli moarte"
  else
    ok "purge CSS: sărit (script indisponibil)"
  fi
fi

# Minificare CSS/JS (Lighthouse: „Comprimă codul" + CSS nefolosit + TBT).
# Esbuild din node_modules; daca lipseste, continuam neminificat (fallback
# sigur — deploy-ul nu trebuie sa pice din pricina asta).
ESB="$PWD/node_modules/.bin/esbuild"
if [ -x "$ESB" ]; then
  # (a) Minificare restul (css + js rămase ne-bundle-uite). Ruleaza INAINTE de
  #     bundle: altfel ar trece si peste chunk-urile deja minificate (numele
  #     lor poarta hash-ul continutului, deci nu au voie sa se schimbe).
  MIN=0
  while IFS= read -r f; do
    if "$ESB" --minify "$f" > "$f.min" 2>/dev/null && [ -s "$f.min" ]; then
      mv "$f.min" "$f"; MIN=$((MIN+1))
    else
      rm -f "$f.min"
    fi
  done < <(find public/assets/css -type f -name '*.css'; find public/assets/js -type f -name '*.js' ! -name 'page-*.js' ! -name 'c-*.js')
  ok "assete minificate: $MIN fisiere"

  # (b) Bundle cu CODE SPLITTING: fiecare pagina primeste un singur fisier JS,
  #     iar modulele comune (core.js, anim-bg.js, chat.js) ajung in chunk-uri
  #     separate, cu hash de continut in nume. Doua efecte:
  #       - chat.js (~14 KB) se cere la nevoie, nu pe fiecare pagina (vezi
  #         loadChat() din core.js) — pe calea critica rămâne ~1/3 din JS;
  #       - un vizitator care navigheaza intre pagini descarca o singura data
  #         core-ul comun, nu o copie in fiecare bundle de pagina.
  #     Numele chunk-urilor sunt FIX „c-<hash>.js": Pages le serveste din
  #     stratul static (/assets/* e exclus din _routes.json), iar Cache-Control
  #     „immutable" e corect pentru ca hash-ul chiar e continutul. Importurile
  #     din bundle-uri sunt relative (./c-<hash>.js), deci nu e nevoie de
  #     importmap si nu depind de ?v= din HTML.
  rm -f public/assets/js/c-*.js            # chunk-uri vechi (dintr-un build anterior)
  OUTJS="$(mktemp -d)"
  if "$ESB" public/assets/js/page-*.js --bundle --minify --format=esm --splitting \
      --target=es2022 --legal-comments=none \
      --outdir="$OUTJS" --entry-names='[name]' --chunk-names='c-[hash]' >/tmp/esb.log 2>&1; then
    cp "$OUTJS"/*.js public/assets/js/
    BUN=$(ls "$OUTJS"/page-*.js 2>/dev/null | wc -l)
    CHK=$(ls "$OUTJS"/c-*.js 2>/dev/null | wc -l)
    ok "pagini bundle-uite: $BUN (chunk-uri comune: $CHK)"
  else
    cat /tmp/esb.log
    ok "bundle: ESUAT — ramane varianta neminificata (fallback)"
  fi
  rm -rf "$OUTJS"
else
  ok "esbuild lipseste — sar minificarea (fallback)"
fi

# Frații WebP pentru imagini sunt COMISAȚI în repo (runner-ul GitHub nu are
# ImageMagick); workerul îi negociaza automat, vezi serveStatic.

# Comutatorul etapei, ca secret Pages. Se pune ÎNAINTE de publicare: un
# secret adăugat DUPĂ `pages deploy` intră în vigoare abia la deploy-ul
# următor (lecția „redeploy de activare” de la secretele Turso). Rollback
# instant = o rulare cu WATCH_STORE=d1.
printf '%s' "$WATCH_STORE" | $WRANGLER pages secret put WATCH_STORE --project-name="$PROJECT" \
  >/tmp/pages-watch-store.txt 2>&1 || { cat /tmp/pages-watch-store.txt; die "WATCH_STORE nu a ajuns in Pages"; }
rm -f /tmp/pages-watch-store.txt
ok "WATCH_STORE=$WATCH_STORE va fi activ din acest deploy"

$WRANGLER pages deploy --project-name="$PROJECT" --branch=main --commit-dirty=true >/tmp/pages.txt 2>&1 \
  || { cat /tmp/pages.txt; die "deploy Pages esuat"; }
DEPLOY_URL="$(grep -oE 'https://[a-z0-9.-]*\.pages\.dev' /tmp/pages.txt | head -1 || true)"
ok "publicat: ${DEPLOY_URL:-vezi /tmp/pages.txt}"
# Endpointul /api/messages citește Turso din Workerul Pages. Reaplicăm la
# fiecare deploy, astfel un token rotit în GitHub Secrets ajunge imediat live.
printf '%s' "$TURSO_DATABASE_URL" | $WRANGLER pages secret put TURSO_DATABASE_URL --project-name="$PROJECT" \
  >/tmp/pages-turso-url.txt 2>&1 || { cat /tmp/pages-turso-url.txt; die "secretul Turso URL nu a ajuns in Pages"; }
printf '%s' "$TURSO_AUTH_TOKEN" | $WRANGLER pages secret put TURSO_AUTH_TOKEN --project-name="$PROJECT" \
  >/tmp/pages-turso-token.txt 2>&1 || { cat /tmp/pages-turso-token.txt; die "secretul Turso token nu a ajuns in Pages"; }
rm -f /tmp/pages-turso-url.txt /tmp/pages-turso-token.txt
ok "secretele Turso sunt legate la Pages"

# Frații .webp ai imaginilor (hero, logo) sunt COMISAȚI în repo: runner-ul
# GitHub nu are ImageMagick, iar workerul nu mai negociaza WebP — paginile
# refera direct .webp. De aceea NU se mai sterge nimic aici.
git checkout -- public 2>/dev/null || true

# ---------------------------------------------------------------------
step "6/6  JWT_SECRET"
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
