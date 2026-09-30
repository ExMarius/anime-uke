#!/usr/bin/env bash
# =====================================================================
# Deploy + verificare LIVE: tot ce face deploy.sh (D1, migrări remote,
# Worker DO, Pages, JWT, purge/minify, ?v=), apoi verificările
# post-deploy pe https://anime-uke.pages.dev (sectiunile 1–20 din mai jos).
#
# SURSA DEPLOY-ULUI (29.09.2026): commitul care a declanșat workflow-ul,
# indiferent de branch. Publicarea din branch-ul sesiunii Arena direct în
# producție, FĂRĂ merge, e regula proprietarului — vezi blocul de mai jos și
# `publish.sh` (metoda sigură de declanșare).
#
# Comportament (25.09):
#   - alege mai întâi contul Cloudflare care chiar vede D1-ul anime-db
#     (secretul CLOUDFLARE_ACCOUNT_ID poate lipse sau fi invalid);
#   - oprește cu exit code-ul lui deploy.sh dacă deploy-ul pică
#     (nu mai merge la audit peste un deces);
#   - workflow-ul lasă rezultatul într-un comentariu pe commit (tokenii
#     redactați) — canalul principal de citire din sandbox (AGENTS.md §3).
#
# Lecție păstrată: propagarea Pages durează zeci de secunde — se așteaptă
# 60s înainte de audit, altfel se verifică deployment-ul anterior.
# =====================================================================
set -uo pipefail

# ── PUBLICARE DIRECTĂ DIN BRANCH-UL SESIUNII (fără merge) ─────────────
# Regula proprietarului (AGENTS.md §1, 29.09.2026): producția se publică
# EXACT din branch-ul de sesiune Arena, fără merge în main și fără PR.
# Până la data asta relay-ul își muta singur arborele pe origin/main (checkout
# detașat) și publica altceva decât codul care îl declanșase — adică munca unei
# sesiuni nu putea ajunge live decât după un merge. Deturnarea aia a fost
# ȘTEARSĂ intenționat; `tests/no-merge-guard.mjs` verifică permanent să nu revină.
#
# Ce publicăm acum: exact commitul cu care a pornit workflow-ul (checkout-ul
# implicit al actions/checkout). Îl scriem în log ca auditul să spună clar ce
# cod a ajuns în producție.
PUBLICA_BRANCHUL_CURENT=1
export PUBLICA_BRANCHUL_CURENT
RELAY_REF="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo necunoscut)}"
RELAY_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo necunoscut)"
export RELAY_REF RELAY_SHA
echo "── publicare DIRECTĂ în producție din ${RELAY_REF}@${RELAY_SHA} (fără merge) ──"
if [ -f cf-relay/deploy-request.txt ]; then
  echo "── cerere de publicare ──"
  grep -vE '^[[:space:]]*(#|$)' cf-relay/deploy-request.txt | tail -3 | sed 's/^/     /'
fi

# Etapa mutării progresului de vizionare. Sursa de adevăr e fișierul comis
# cf-relay/watch-stage.txt (ultima linie nevidă care nu e comentariu); un
# input manual sau variabila de repo WATCH_STORE îl pot suprascrie.
WATCH_STORE="${WATCH_STORE:-}"
if [ -z "$WATCH_STORE" ] && [ -f cf-relay/watch-stage.txt ]; then
  WATCH_STORE="$(grep -vE '^[[:space:]]*(#|$)' cf-relay/watch-stage.txt | tail -1 | tr -d '[:space:]')"
fi
case "$WATCH_STORE" in d1|shadow|turso) ;; *) WATCH_STORE="d1" ;; esac
export WATCH_STORE
echo "── etapa watch_progress: WATCH_STORE=$WATCH_STORE ──"

# Secretul CLOUDFLARE_ACCOUNT_ID poate fi gol, cu spații, sau un ID care nu
# e contul cu D1. Alegem contul pe care tokenul chiar vede baza anime-db.
echo "── aleg contul care vede D1 ──"
CLOUDFLARE_ACCOUNT_ID="$(printf '%s' "${CLOUDFLARE_ACCOUNT_ID:-}" | tr -d '[:space:]')"
export CLOUDFLARE_ACCOUNT_ID
echo "id din env: lungime ${#CLOUDFLARE_ACCOUNT_ID} hex32=$(printf '%s' "$CLOUDFLARE_ACCOUNT_ID" | grep -qE '^[0-9a-fA-F]{32}$' && echo da || echo nu)"
curl -sS -m 25 https://api.cloudflare.com/client/v4/accounts \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -o /tmp/cf-accounts.json || true
node <<'JS'
const fs = require('fs');
let j = {};
try { j = JSON.parse(fs.readFileSync('/tmp/cf-accounts.json', 'utf8')); } catch { j = { success: false, errors: [{ message: 'json-invalid' }] }; }
const list = Array.isArray(j.result) ? j.result : [];
const mask = (id) => (!id ? '(gol)' : `${id.slice(0, 4)}…${id.slice(-4)} len=${id.length}`);
const err = (j.errors && j.errors[0] && (j.errors[0].message || j.errors[0].code)) || '';
console.log(`conturi: success=${j.success} n=${list.length} eroare=${err}`);
fs.writeFileSync('/tmp/cf-accounts.tsv', list.map((a) => `${a.id}\t${String(a.name || '').replace(/\s+/g, ' ')}`).join('\n') + (list.length ? '\n' : ''));
for (const a of list) console.log(`  ${a.name || '?'}  ${mask(a.id)}`);
const env = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const hit = list.find((a) => a.id === env);
console.log(`env ${mask(env)} e in lista: ${hit ? 'da (' + hit.name + ')' : 'nu'}`);
JS
BEST=""
BEST_NAME=""
while IFS=$'\t' read -r id name; do
  [ -z "${id:-}" ] && continue
  RAW="$(curl -sS -m 25 "https://api.cloudflare.com/client/v4/accounts/${id}/d1/database" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -w '\n__HTTP__:%{http_code}' || printf '\n__HTTP__:curl-esuat')"
  HTTP="$(printf '%s' "$RAW" | sed -n 's/^__HTTP__://p' | tail -1)"
  printf '%s' "$RAW" | sed '/^__HTTP__:/d' > /tmp/cf-d1.json
  INFO="$(node -e '
    let j={}; try { j=JSON.parse(require("fs").readFileSync("/tmp/cf-d1.json","utf8")); } catch { j={success:false,errors:[{message:"json-invalid"}]}; }
    const err=(j.errors&&j.errors[0]&&(j.errors[0].message||j.errors[0].code))||"";
    const names=(Array.isArray(j.result)?j.result:[]).map(d=>d.name).join(",");
    const has=(Array.isArray(j.result)?j.result:[]).some(d=>d.name==="anime-db");
    console.log("success="+j.success+" db=["+names+"] anime-db="+has+" eroare="+err);
  ')"
  echo "  D1 ${name}: HTTP ${HTTP} ${INFO}"
  if printf '%s' "$INFO" | grep -q 'anime-db=true'; then BEST="$id"; BEST_NAME="$name"; break; fi
  if printf '%s' "$INFO" | grep -q 'success=true' && [ -z "$BEST" ]; then BEST="$id"; BEST_NAME="$name"; fi
done < /tmp/cf-accounts.tsv
if [ -z "$BEST" ]; then
  echo "✗ niciun cont accesibil nu vede D1. Tokenul are nevoie de permisiunea D1 Edit pe contul unde e anime-uke."
  exit 1
fi
export CLOUDFLARE_ACCOUNT_ID="$BEST"
echo "folosesc ${BEST_NAME} (lungime ${#BEST})"

# Git integration face și builduri Pages la fiecare push. Înainte de deploy
# arătăm configurația activă, fără secrete, ca un build de preview căzut să nu
# rămână o cutie neagră la pregătirea lansării publice.
echo "── conexiunea Pages + Git (configurația de build) ──"
curl -sS -m 25 "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/anime-uke" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -o /tmp/cf-pages-project.json || true
node <<'JS'
const fs = require('fs');
let j = {};
try { j = JSON.parse(fs.readFileSync('/tmp/cf-pages-project.json', 'utf8')); } catch { j = { success: false, errors: [{ message: 'json-invalid' }] }; }
const p = j.result || {};
const b = p.build_config || {};
const err = (j.errors && j.errors[0] && (j.errors[0].message || j.errors[0].code)) || '';
const val = (x) => JSON.stringify(String(x == null ? '' : x));
console.log(`Pages project: success=${j.success} eroare=${err}`);
console.log(`Git build: production_branch=${val(p.production_branch)} root_dir=${val(b.root_dir)} build_command=${val(b.build_command)} destination_dir=${val(b.destination_dir)}`);
JS

./deploy.sh
DEPLOY_RC=$?
echo "exit deploy: $DEPLOY_RC"
if [ "$DEPLOY_RC" -ne 0 ]; then exit "$DEPLOY_RC"; fi
echo "aștept 60s propagarea…"; sleep 60

B="https://anime-uke.pages.dev"
V="$(git rev-parse --short HEAD)"

# La momentul acesta buildul Git declanșat de același push a avut timp să se
# termine. Legăm statusul Pages de SHA-ul exact și, numai la eșec, păstrăm o
# coadă redactată de log — altfel un check roșu din GitHub nu are diagnostic.
echo "── Git Pages: buildul declanșat de acest commit ──"
: > /tmp/cf-pages-failed-deployment-id
curl -sS -m 25 "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/anime-uke/deployments?per_page=20" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -o /tmp/cf-pages-deployments.json || true
PAGES_GIT_SHA="$(git rev-parse HEAD)" node <<'JS'
const fs = require('fs');
let j = {};
try { j = JSON.parse(fs.readFileSync('/tmp/cf-pages-deployments.json', 'utf8')); } catch { j = { success: false, errors: [{ message: 'json-invalid' }] }; }
const err = (j.errors && j.errors[0] && (j.errors[0].message || j.errors[0].code)) || '';
const sha = process.env.PAGES_GIT_SHA || '';
const list = Array.isArray(j.result) ? j.result : [];
const matches = list.filter((x) => x?.deployment_trigger?.metadata?.commit_hash === sha);
// deploy.sh publică și el același SHA, dar în producție. Pentru sănătatea
// integrării alegem explicit deployment-ul declanșat de Git (preview), nu
// pe cel manual, mai nou, pe care tocmai l-am publicat prin relay.
const d = matches.find((x) => x?.deployment_trigger?.type === 'github')
  || matches.find((x) => x?.environment === 'preview')
  || matches[0];
if (!d) {
  console.log(`Git Pages deployment: găsit=nu success=${j.success} eroare=${err}`);
  process.exit(0);
}
const stages = (d.stages || []).map((x) => `${x.name}:${x.status}`).join(',');
const status = (d.latest_stage && d.latest_stage.status) || '';
const trigger = (d.deployment_trigger && d.deployment_trigger.type) || '';
console.log(`Git Pages deployment: găsit=da trigger=${trigger} env=${d.environment || ''} status=${status} stages=${stages} url=${d.url || ''}`);
if (status === 'failure' && d.id) fs.writeFileSync('/tmp/cf-pages-failed-deployment-id', String(d.id));
JS
PAGES_FAILED_ID="$(cat /tmp/cf-pages-failed-deployment-id 2>/dev/null || true)"
if [ -n "$PAGES_FAILED_ID" ]; then
  echo "   build Git eșuat: diagnostic redactat (ultimele 30 de linii)"
  curl -sS -m 25 "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/anime-uke/deployments/${PAGES_FAILED_ID}/history/logs" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -o /tmp/cf-pages-build-logs.json || true
  node <<'JS'
const fs = require('fs');
let j = {};
try { j = JSON.parse(fs.readFileSync('/tmp/cf-pages-build-logs.json', 'utf8')); } catch { j = { success: false, errors: [{ message: 'json-invalid' }] }; }
const err = (j.errors && j.errors[0] && (j.errors[0].message || j.errors[0].code)) || '';
const data = j.result && j.result.data;
const rows = Array.isArray(data) ? data : [];
const text = rows.map((x) => typeof x === 'string' ? x : (x.message || x.text || JSON.stringify(x))).join('\n');
const clean = text.replace(/\x1b\[[0-9;]*m/g, '').replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]');
console.log(`   log Pages: success=${j.success} linii=${rows.length} eroare=${err}`);
console.log(clean.split('\n').filter(Boolean).slice(-30).join('\n') || '   (fără linii de log disponibile)');
JS
fi

echo
echo "════════ BUGEte (integrare): commit $V ════════"

echo "── 1. asset static: Cache-Control dintr-o singură sursă (fără worker în cale)"
curl -sI "$B/assets/css/style.css?v=$V" | grep -i '^cache-control' | tr -d '\r'
echo "   (înainte de _routes.json ieșea „no-cache, no-cache” = assetul trecea și prin worker)"

echo "── 2. asset static: headere de securitate din public/_headers (așteptat 6)"
curl -sI "$B/assets/css/style.css?v=$V" \
  | grep -icE '^(content-security-policy|x-frame-options|permissions-policy|strict-transport-security|cross-origin-resource-policy|x-content-type-options)'

echo "── 3. poarta de autentificare (ce NU e în _routes.json)"
for p in /profile /admin /shop /admin/serii; do
  echo "   $p → $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B$p")"
done

echo "── 4. SSR + 404 real (rutele care trec prin worker)"
for p in /serie/99999999 /episod/99999999 /package.json; do
  echo "   $p → $(curl -s -o /dev/null -w '%{http_code}' "$B$p") (404)"
done
echo "   /series → $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/series") (301 spre /)"

echo "── 5. SSR SEO pe episod (feature-ul din PR #4) — titlu + JSON-LD TVEpisode"
EP="$(curl -s "$B/sitemap.xml" | grep -o '/episod/[0-9]*' | head -1)"
if [ -n "$EP" ]; then
  curl -s "$B$EP" > /tmp/ep.html
  echo "   $EP → $(curl -s -o /dev/null -w '%{http_code}' "$B$EP")"
  echo "   title: $(grep -oE '<title>[^<]*</title>' /tmp/ep.html | head -1 | cut -c1-100)"
  echo "   JSON-LD TVEpisode: $(grep -c 'TVEpisode' /tmp/ep.html) · BreadcrumbList: $(grep -c 'BreadcrumbList' /tmp/ep.html)"
else
  echo "   ! niciun episod în sitemap"
fi

echo "── 6. /api/home: prima pagină într-o singură cerere"
curl -s "$B/api/home" | head -c 150; echo
echo "   chei: $(curl -s "$B/api/home" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(Object.keys(JSON.parse(d)).join(", "))}catch{process.stdout.write("NU E JSON")}})')"

echo "── 7. imagini: .webp direct (+ logo .webp), og:image rămâne .png"
for img in hero-1.webp logo-icon.webp logo.png; do
  echo "   $img → $(curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}B' "$B/assets/img/$img")"
done
echo "   referințe .webp în HTML: $(curl -s "$B/" | grep -c 'logo-icon.webp\|hero-1.webp') · .png în <img>: $(curl -s "$B/" | grep -c 'src=\"/assets/img/logo-icon.png\"')"

echo "── 8. sitemap-uri GSC + llms"
for s in /sitemap.xml /sitemap.txt /llms.txt /robots.txt; do
  echo "   $s → $(curl -s -o /dev/null -w '%{http_code}' "$B$s")"
done

echo "── 9. rute moarte + SEO (verificările rândului de lucru #4, păstrate)"
for p in /404 /admin/serie /covers/x.png /ruta-inexistenta /AGENTS.md /deploy.sh /src/worker.js; do
  echo "   $p → $(curl -s -o /dev/null -w '%{http_code}' "$B$p")"
done
echo "   robots Allow: /series (trebuie 0): $(curl -s "$B/robots.txt" | grep -c 'Allow: /series')"
echo "   speculationrules prerender: $(curl -s "$B/speculationrules.json" | tr -d ' \n' | head -c 80)"
echo "   /profile.html (nelogat) → $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/profile.html")"
echo "   /series?id=1014 (forma veche) → $(curl -s -o /dev/null -w '%{http_code}' "$B/series?id=1014") (trebuie 200)"
echo "   /login noindex: $(curl -s "$B/login" | grep -c 'noindex') · canonical: $(curl -s "$B/login" | grep -c 'rel=\"canonical\"')"

echo "── 10. D1 producție: migrările 0026 (shop 2.0) și 0027 (sezon)"
W="npx wrangler"; [ -x "$PWD/node_modules/.bin/wrangler" ] && W="$PWD/node_modules/.bin/wrangler"
$W d1 execute DB --remote --command "SELECT xp_boost_until FROM users LIMIT 1" >/dev/null 2>&1 \
  && echo "   migrare 0026: coloana xp_boost_until există pe D1 producție" \
  || echo "   migrare 0026: LIPSEȘTE coloana xp_boost_until de pe producție!"
echo "   migrare 0027 (site_settings.seasonal_theme): $($W d1 execute DB --remote --command "SELECT value FROM site_settings WHERE key = 'seasonal_theme'" --json 2>/dev/null | tr -d ' \n' | head -c 120)"
echo "   posesori temă de sezon (user_items.theme_sunset): $($W d1 execute DB --remote --command "SELECT COUNT(*) AS n FROM user_items WHERE item_id = 'theme_sunset'" --json 2>/dev/null | tr -d ' \n' | head -c 120)"

echo "── 11. teme animate + sezon în bundle-ul din producție (CSS purgat, motor canvas)"
VC="$(curl -s "$B/" | grep -oE '[a-z0-9.-]+\.(css|js)\?v=[A-Za-z0-9._-]+' | head -1 | cut -d= -f2)"
curl -s "$B/assets/css/style.css?v=$VC" -o /tmp/st.css
echo "   css: $(for t in nc-sunset theme-sakura theme-royal theme-sunset theme-aurora theme-ocean theme-petale theme-portocaliu theme-iarna theme-halloween theme-paste; do printf '%s=%s ' "$t" "$(grep -c "$t" /tmp/st.css)"; done)"
echo "   keyframes: $(grep -o '@keyframes theme-[a-z-]*' /tmp/st.css | sort -u | tr '\n' ' ')(trebuie 3 nume: aurora, ocean, sunset)"
curl -s "$B/assets/js/anim-bg.js?v=$VC" -o /tmp/ab.js
echo "   motor canvas: $(for t in requestAnimationFrame petale bule stele portocaliu fulgi iarna halloween paste; do printf '%s=%s ' "$t" "$(grep -c "$t" /tmp/ab.js)"; done)(toate ≥1) · prefers-reduced-motion=$(grep -c 'prefers-reduced-motion' /tmp/ab.js) (trebuie 0)"

echo "── 12. bundle-uri de pagină + diagnostice cache (shop/profil/teme)"
curl -s "$B/assets/js/page-shop.js?v=$VC" -o /tmp/ps.js
echo "   shop: $(for t in shop-boost reward_text nc-sunset; do printf '%s=%s ' "$t" "$(grep -c "$t" /tmp/ps.js)"; done)(toate ≥1)"
curl -s "$B/assets/js/page-profile.js?v=$VC" -o /tmp/pp.js
echo "   profil: use_token=$(grep -c 'use_token' /tmp/pp.js) (≥1) · temă instant în bundle: auk-theme=$(grep -c 'auk-theme' /tmp/ps.js) (≥1)"
echo "   head /shop: $(curl -sI "$B/shop" | grep -i '^cache-control' | tr -d '\r')"
echo "   head / (html): $(curl -sI "$B/" | grep -i '^cache-control' | tr -d '\r')"
echo "   ?v= live din /: $VC · din /shop: $(curl -s "$B/shop" | grep -oE 'page-shop\.js\?v=[A-Za-z0-9._-]+' | head -1 | cut -d= -f2) (gol = /shop e în spatele login-ului, normal)"

echo "── 13. poarta admin (economie) + sezon"
echo "   GET /api/admin/users anonim → $(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/users") (trebuie 401)"
echo "   GET /api/admin/season anonim → $(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/season") (trebuie 401)"
echo "   /admin anonim → $(curl -s -o /dev/null -w '%{http_code}' "$B/admin") (trebuie 302)"

echo "── 14. migrarea 0028: contoarele + planurile de execuție pe D1 de producție"
W="npx wrangler"; [ -x "$PWD/node_modules/.bin/wrangler" ] && W="$PWD/node_modules/.bin/wrangler"
$W d1 execute DB --remote --command "SELECT rating_avg, rating_count FROM anime_series LIMIT 1" >/dev/null 2>&1 \
  && echo "   0028: coloanele rating_avg/rating_count există pe anime_series" \
  || echo "   0028: LIPSESC coloanele rating_avg/rating_count!"
echo "   0028: contor users_total → $($W d1 execute DB --remote --command "SELECT value FROM site_meta WHERE key='users_total'" --json 2>/dev/null | grep -o '\"value\": *[0-9]*' | head -1)"
echo "   0028: contor views_total → $($W d1 execute DB --remote --command "SELECT value FROM site_meta WHERE key='views_total'" --json 2>/dev/null | grep -o '\"value\": *[0-9]*' | head -1)"

# Planurile de execuție sunt dovada că indexurile din 0028 sunt FOLOSITE pe
# datele reale: „SCAN <tabel mare>" = se citesc toate rândurile (metrica taxată
# de D1), „SEARCH ... USING INDEX" = doar câteva.
plan() {
  local name="$1" sql="$2" out
  out="$($W d1 execute DB --remote --command "EXPLAIN QUERY PLAN $sql" --json 2>/dev/null \
    | grep -o '"detail":[^,}]*' | sed 's/"detail": *//' | tr -d '"' | tr '\n' '|')"
  echo "   $name → $out"
}
plan "top săptămânal" "SELECT e.series_id FROM watch_progress w JOIN episodes e ON e.id = w.episode_id WHERE w.updated_at >= datetime('now','-7 days') GROUP BY e.series_id LIMIT 5"
plan "top notate"     "SELECT id FROM anime_series WHERE rating_count > 0 ORDER BY rating_avg DESC, rating_count DESC LIMIT 5"
plan "catalog"        "SELECT s.id FROM anime_series s ORDER BY s.created_at DESC, s.id DESC LIMIT 25 OFFSET 0"
plan "pulse"          "SELECT key, value FROM site_meta WHERE key IN ('series_total','episodes_total','users_total','views_total')"
SCANS="$($W d1 execute DB --remote --command "EXPLAIN QUERY PLAN SELECT e.series_id FROM watch_progress w JOIN episodes e ON e.id = w.episode_id WHERE w.updated_at >= datetime('now','-7 days') GROUP BY e.series_id LIMIT 5" --json 2>/dev/null | grep -c 'SCAN watch_progress')"
echo "   scanări de watch_progress în topul săptămânal (trebuie 0): $SCANS"

echo "── 15. aspect: regulile noi trec de PurgeCSS și ajung în bundle-ul live"
VC2="$(curl -s "$B/" | grep -oE '[a-z0-9.-]+\.(css|js)\?v=[A-Za-z0-9._-]+' | head -1 | cut -d= -f2)"
curl -s "$B/assets/css/style.css?v=$VC2" -o /tmp/ux.css
echo "   css: badge-rating=$(grep -c 'badge-rating' /tmp/ux.css) to-top=$(grep -c '\.to-top' /tmp/ux.css) prog=$(grep -c 'continue-card__prog' /tmp/ux.css) kbd=$(grep -c 'search__kbd' /tmp/ux.css) (toate ≥1)"
echo "   filtre lipicioase (cat-filters sticky): $(grep -c 'position:sticky\|position: sticky' /tmp/ux.css) ocurențe de sticky în CSS"
curl -s "$B/assets/js/core.js?v=$VC2" -o /tmp/u-core.js
echo "   core.js: butonul „înapoi sus” prezent: $(grep -c 'to-top' /tmp/u-core.js) · rAF folosit: $(grep -c 'requestAnimationFrame' /tmp/u-core.js)"
curl -s "$B/assets/js/page-index.js?v=$VC2" -o /tmp/u-idx.js
# Esbuild scrie non-ASCII escapat („min v\u0103zute") și normalizează
# ghilimelele, deci verificările de mai jos caută numai formei ASCII sigure.
echo "   page-index.js: nota pe card=$(grep -c 'badge-rating' /tmp/u-idx.js) · minute văzute=$(grep -c 'min v' /tmp/u-idx.js) · scurtatura /= $(grep -c '!=="/"' /tmp/u-idx.js)"
echo "   html: <kbd> scurtătura = $(curl -s "$B/" | grep -c 'search__kbd')"
# Fără node inline aici: ghilimelele amestecate într-un $( ) lung sunt o
# capcană pentru următoarea persoană care editează scriptul (a mușcat deja).
NOTA_RAW="$(curl -s "$B/api/series?per_page=1")"
case "$NOTA_RAW" in
  *'"rating_avg"'*'"rating_count"'*) echo "   /api/series aduce nota pe randul seriei: da" ;;
  *) echo "   /api/series aduce nota pe randul seriei: NU — ${NOTA_RAW:0:160}" ;;
esac


echo "── 16. chat: ce e SALVAT de fapt în producție (D1)"
W2="npx wrangler"; [ -x "$PWD/node_modules/.bin/wrangler" ] && W2="$PWD/node_modules/.bin/wrangler"
# wrangler --json scrie JSON INDENTAT (pe mai multe linii), deci nu se poate
# extrage cu grep linie-cu-linie: îl parcurge node și scoate doar results.
q() { $W2 d1 execute DB --remote --json --command "$1" 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(JSON.stringify((j[0]&&j[0].results)||[]))}catch(e){process.stdout.write("(raspuns necitit)")}})'; echo; }
echo "   total rânduri:      $(q 'SELECT COUNT(*) AS n FROM chat_messages')"
echo "   în ultimele 24h:    $(q "SELECT COUNT(*) AS n FROM chat_messages WHERE created_at >= datetime('now','-1 day')")"
echo "   în ultimele 7 zile: $(q "SELECT COUNT(*) AS n FROM chat_messages WHERE created_at >= datetime('now','-7 days')")"
echo "   primele/ultimele id: $(q 'SELECT MIN(id) AS min_id, MAX(id) AS max_id FROM chat_messages')"
echo "   ultimele 8 mesaje:"
q 'SELECT id, username, substr(message,1,28) AS mesaj, created_at FROM chat_messages ORDER BY id DESC LIMIT 8' | sed 's/^/     /'

# ── 17. CANARUL DE CHAT ───────────────────────────────────────────────
# Bug-ul de azi („nu se salvează mesajele, nici stickerele") a trecut prin
# TOATE suitele locale: în miniflare DO-ul nu e evacuat niciodată, deci
# bufferul din memorie ajungea mereu în D1. Dovada reală e un mesaj scris pe
# chat-ul viu, cu UN mesaj (nu un lot de 10), apoi citit din baza de date.
# Contul canar se șterge la final, împreună cu mesajele lui. Același cont
# verifică și marcajele de progres („văzut" / episodul următor) — fără o a doua
# înregistrare, căci limita e 5 conturi pe oră per IP și rulările repetate ar
# da fals roșu.
echo
echo "── 17. chat: canar end-to-end (mesaj + sticker pe site-ul viu)"
CANAR_OUT="$(node cf-relay/chat-canar.mjs "$B" 2>&1)"
CANAR_RC=$?
echo "$CANAR_OUT" | sed 's/^/     /'
CANAR_USER="$(echo "$CANAR_OUT" | sed -n 's/^  __CANAR_USER__=//p' | head -1)"
CANAR_TEXT="$(echo "$CANAR_OUT" | sed -n 's/^  __CANAR_TEXT__=//p' | head -1)"
if [ "$CANAR_RC" -ne 0 ]; then
  echo "   !! canarul a picat (exit $CANAR_RC) — chatul NU salvează în producție"
else
  echo "   dovezi în D1 (rândurile canarului, citite direct din baza de date):"
  q "SELECT id, username, message, created_at FROM chat_messages WHERE username = '$CANAR_USER' ORDER BY id" | sed 's/^/     /'
  N_TEXT="$(q "SELECT COUNT(*) AS n FROM chat_messages WHERE username = '$CANAR_USER' AND message = '$CANAR_TEXT'")"
  N_STICK="$(q "SELECT COUNT(*) AS n FROM chat_messages WHERE username = '$CANAR_USER' AND message = '[sticker:naruto]'")"
  case "$N_TEXT" in *'"n":1'*) echo "   mesajul e ÎN D1: da" ;; *) echo "   mesajul e ÎN D1: NU ($N_TEXT)" ;; esac
  case "$N_STICK" in *'"n":1'*) echo "   stickerul e ÎN D1: da" ;; *) echo "   stickerul e ÎN D1: NU ($N_STICK)" ;; esac
fi
# Curățenie: dispare contul, mesajele lui și contorul se reface din COUNT(*)
# (contorul users_total e denormalizat — îl realiniem exact, nu pe încredere).
q "DELETE FROM chat_messages WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'canar%')" >/dev/null
q "DELETE FROM users WHERE username LIKE 'canar%'" >/dev/null
q "UPDATE site_meta SET value = (SELECT COUNT(*) FROM users) WHERE key = 'users_total'" >/dev/null
echo "   după curățenie: $(q 'SELECT COUNT(*) AS n FROM chat_messages') rânduri în chat_messages, $(q 'SELECT COUNT(*) AS n FROM users') conturi"
# Canarul nu are voie să lase urme: dacă a rămas vreun cont sau vreun mesaj
# „canar%” în tabel, îl raportăm aici (curățenia a eșuat, nu testul de chat).
RAMASE="$(q "SELECT COUNT(*) AS n FROM chat_messages WHERE username LIKE 'canar%'")"
case "$RAMASE" in *'"n":0'*) echo "   urme rămase după canar: 0 (curat)" ;; *) echo "   !! urme rămase după canar: $RAMASE" ;; esac
# Progresul canarului (watch_progress) se șterge în cascada odată cu contul:
RAMASE_WP="$(q "SELECT COUNT(*) AS n FROM watch_progress wp JOIN users u ON u.id = wp.user_id WHERE u.username LIKE 'canar%'")"
case "$RAMASE_WP" in *'"n":0'*) echo "   progres rămas după canar: 0 (curat)" ;; *) echo "   !! progres rămas după canar: $RAMASE_WP" ;; esac

# ── 17b. CANARUL DE PRIETENIE (notificări) ────────────────────────────
# Cererile de prietenie sunt anunțate în clopot: friend_request când cineva
# îți trimite o cerere, friend_accepted când ți-o acceptă. Doveza live e
# fluxul întreg pe două conturi temporare (register + cerere + acceptare),
# apoi rândurile citite DIRECT din D1 — ca la canarul de chat, pentru că o
# scriere în cod nu demostrează nimic pe producție.
echo
echo "── 17b. prietenie: canar end-to-end (cerere + acceptare → notificări)"
FRIENDS_OUT="$(node cf-relay/friends-canar.mjs "$B" 2>&1)"
FRIENDS_RC=$?
echo "$FRIENDS_OUT" | sed 's/^/     /'
FA="$(echo "$FRIENDS_OUT" | sed -n 's/^  __CANAR_A__=//p' | head -1)"
FB="$(echo "$FRIENDS_OUT" | sed -n 's/^  __CANAR_B__=//p' | head -1)"
FA_ID="$(echo "$FRIENDS_OUT" | sed -n 's/^  __CANAR_A_ID__=//p' | head -1)"
FB_ID="$(echo "$FRIENDS_OUT" | sed -n 's/^  __CANAR_B_ID__=//p' | head -1)"
FDM="$(echo "$FRIENDS_OUT" | sed -n 's/^  __CANAR_DM_TEXT__=//p' | head -1)"
if [ "$FRIENDS_RC" -ne 0 ]; then
  echo "   !! canarul de prietenie a picat (exit $FRIENDS_RC) — notificările NU ajung în producție"
else
  if [ -n "$FA" ] && [ -n "$FB" ]; then
    echo "   dovezi în D1 (notificările celor două conturi canar):"
    q "SELECT u.username, n.type, n.payload, n.read FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.username IN ('$FA','$FB') ORDER BY n.id" | sed 's/^/     /'
    N_FR="$(q "SELECT COUNT(*) AS n FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.username = '$FA' AND n.type = 'friend_request'")"
    N_ACC="$(q "SELECT COUNT(*) AS n FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.username = '$FB' AND n.type = 'friend_accepted'")"
    case "$N_FR" in *'"n":1'*) echo "   cererea de prietenie e în D1 (notificare către destinatar): da" ;; *) echo "   !! lipsește notificarea de cerere în D1: $N_FR" ;; esac
    case "$N_ACC" in *'"n":1'*) echo "   acceptarea e în D1 (notificare către solicitant): da" ;; *) echo "   !! lipsește notificarea de acceptare în D1: $N_ACC" ;; esac
  fi
fi
# Dovada persistenței DM nu mai poate veni din D1: mesajele private trăiesc
# în baza separată Turso. Scriptul caută exact textul canar între cele două ID-uri
# și curăță rândurile înainte ca utilizatorii temporari să fie șterși din D1.
echo "   dovadă directă în Turso (anime-uke-messages):"
TURSO_CANAR_OUT="$(node scripts/turso-canary.mjs "$FA_ID" "$FB_ID" "$FDM" 2>&1)"
TURSO_CANAR_RC=$?
echo "$TURSO_CANAR_OUT" | sed 's/^/     /'
if [ "$TURSO_CANAR_RC" -ne 0 ]; then
  echo "   !! canarul Turso a picat (exit $TURSO_CANAR_RC) — DM-ul nu este confirmat în baza separată"
fi
# Partea de frontend: notificarea de prietenie trebuie să ducă la profilul
# persoanei (/profile?u=…), nu să fie fără link. Markerul e ASCII, deci
# supraviețuiește minificării; se caută în chunk-ul comun publicat.
CHUNK_F="$(curl -s "$B/assets/js/page-index.js" | grep -oE 'c-[A-Za-z0-9_-]+\.js' | head -1)"
if [ -n "$CHUNK_F" ]; then
  HREF_F="$(curl -s "$B/assets/js/$CHUNK_F" | grep -c '/profile?u=' || true)"
  echo "   bundle: linkul notificării de prietenie către profil (/profile?u=): $HREF_F (trebuie >= 1)"
else
  echo "   !! nu am găsit chunk-ul comun (code splitting inactiv?)"
fi
# Curățenie: conturile dispar, iar ON DELETE CASCADE curăță prietenia și
# notificările. Contorul users_total e denormalizat — îl realiniem.
q "DELETE FROM users WHERE username LIKE 'canarp%'" >/dev/null
q "UPDATE site_meta SET value = (SELECT COUNT(*) FROM users) WHERE key = 'users_total'" >/dev/null
echo "   după curățenie: $(q 'SELECT COUNT(*) AS n FROM users') conturi"
N_RAMAS="$(q "SELECT COUNT(*) AS n FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.username LIKE 'canarp%'")"
case "$N_RAMAS" in *'"n":0'*) echo "   notificări canar rămase: 0 (curat)" ;; *) echo "   !! notificări canar rămase: $N_RAMAS" ;; esac

# ── 18. FUNCȚIONALITĂȚI NOI (runda 2) ─────────────────────────────────
# Verificăm pe CSS-ul/JS-ul PUBLICAT (nu pe sursă): PurgeCSS poate șterge o
# clasă nouă, iar esbuild escapează non-ASCII, deci căutăm doar ace ASCII.
# Fără ghilimele tipografice aici: „...” amestecat cu " într-un echo închide
# șirul bash (capcana care a mușcat deja de două ori în acest fișier).
echo
echo "── 18. catalog partajabil, notare, marcaje de episoade (build publicat)"
CSS_NEW="$(curl -s "$B/assets/css/style.css")"
case "$CSS_NEW" in *ep-seen*) echo "   CSS: marcajele de episoade (ep-seen) = da" ;; *) echo "   CSS: marcajele de episoade (ep-seen) = NU" ;; esac
case "$CSS_NEW" in *continue-card__next*) echo "   CSS: butonul de episod urmator (continue-card__next) = da" ;; *) echo "   CSS: butonul de episod urmator = NU" ;; esac
case "$CSS_NEW" in *is-watched*) echo "   CSS: bara laterala a episoadelor vazute = da" ;; *) echo "   CSS: bara laterala a episoadelor vazute = NU" ;; esac
JS_NEW="$(curl -s "$B/assets/js/page-index.js")"
case "$JS_NEW" in *auk-continue-next*) echo "   JS: preferinta de episod urmator (localStorage) = da" ;; *) echo "   JS: preferinta de episod urmator = NU" ;; esac
case "$JS_NEW" in *pushState*) echo "   JS: filtrele scriu URL-ul (pushState) = da" ;; *) echo "   JS: filtrele scriu URL-ul = NU" ;; esac
# Sortarea noua trebuie sa existe in lista servita de API...
SORTS_RAW="$(curl -s "$B/api/series?per_page=1")"
case "$SORTS_RAW" in *'"value":"rating"'*) echo "   API: sortarea rating e listata = da" ;; *) echo "   API: sortarea rating lipseste" ;; esac
# ...si chiar sa ordoneze: seriile notate înaintea celor fara voturi.
RATED_RAW="$(curl -s "$B/api/series?sort=rating&per_page=4")"
RATED_OK="$(printf '%s' "$RATED_RAW" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const r=j.series||[];const primulFara=r.findIndex(x=>!(Number(x.rating_count)>0));const primulCu=r.findIndex(x=>Number(x.rating_count)>0);process.stdout.write((r.length>0&&(primulCu===-1||primulFara===-1||primulCu<primulFara))?"da":"NU")}catch(e){process.stdout.write("necited")}})')"
RATED_INFO="$(printf '%s' "$RATED_RAW" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const r=j.series||[];const primulFara=r.findIndex(x=>!(Number(x.rating_count)>0));const primulCu=r.findIndex(x=>Number(x.rating_count)>0);const ok=r.length>0&&(primulCu===-1||primulFara===-1||primulCu<primulFara);process.stdout.write((ok?"da":"NU")+" ["+r.map(x=>x.id+":"+(x.rating_count||0)).join(" ")+"]")}catch(e){process.stdout.write("necited")}})')"
echo "   API: sort=rating pune seriile notate primele = $RATED_INFO"
# Pagina cu filtru trebuie sa serveasca shell-ul normal (SPA), nu 404.
case "$(curl -s -o /dev/null -w '%{http_code}' "$B/?gen=Actiune&status=ongoing")" in
  200) echo "   pagina cu filtru in URL raspunde 200" ;;
  *) echo "   !! pagina cu filtru in URL NU raspunde 200" ;;
esac

echo
echo "── 19. viteza: chunk-uri comune in build-ul publicat"
# Bundle-ul paginii cere codul comun (core.js, anim-bg.js) dintr-un chunk
# separat, cu hash de continut in nume, iar chatul e AMANAT: importul lui
# dinamic sta in chunk-ul comun, nu in bundle-ul paginii. Verificam pe LIVE ca
# graful chiar exista si se serveste corect - daca un chunk lipseste, pagina
# ramane fara JS si nimeni nu-si da seama de ce.
# Fara ghilimele tipografice si fara ghilimele drepte in echo (capcana deja
# cunoscuta a acestui fisier).
JS_IDX="$(curl -s "$B/assets/js/page-index.js")"
CHUNK="$(printf '%s' "$JS_IDX" | grep -oE 'from"\./c-[A-Za-z0-9_-]+\.js"' | head -1 | grep -oE 'c-[A-Za-z0-9_-]+\.js')"
if [ -n "$CHUNK" ]; then
  echo "   chunk comun cerut de bundle-ul paginii: $CHUNK -> $(curl -s -o /dev/null -w '%{http_code} %{size_download}B' "$B/assets/js/$CHUNK")"
  echo "   cache: $(curl -s -o /dev/null -D - "$B/assets/js/$CHUNK" | grep -i '^cache-control' | tr -d '\r' | head -1)"
  CH_TEXT="$(curl -s "$B/assets/js/$CHUNK")"
  AMANAT="$(printf '%s' "$CH_TEXT" | grep -oE 'import\("\./c-[A-Za-z0-9_-]+\.js"\)' | head -1 | grep -oE 'c-[A-Za-z0-9_-]+\.js')"
  if [ -n "$AMANAT" ]; then
    echo "   chat amanat (import dinamic in chunk-ul comun): $AMANAT -> $(curl -s -o /dev/null -w '%{http_code} %{size_download}B' "$B/assets/js/$AMANAT")"
  else
    echo "   !! niciun chunk amanat: chatul a intrat pe calea critica"
  fi
else
  echo "   !! bundle-ul paginii nu importa niciun chunk (code splitting inactiv?)"
fi
case "$JS_IDX" in *'auk-continue-next'*) echo "   markerii rundei 2 supravietuiesc split-ului = da" ;; *) echo "   !! markerii rundei 2 au disparut din bundle-ul paginii" ;; esac
# Runda 3 a redimensionat arta hero (era 168 738 B), a scos preload-ul
# redundant (imaginea e deja inline in HTML) si a adaugat preconnect la hostul
# coperților. Toate trei se vad doar pe build-ul publicat.
HERO_B="$(curl -s -o /dev/null -w '%{size_download}' "$B/assets/img/hero-1.webp")"
echo "   hero-1.webp: ${HERO_B} B (inainte de runda 3: 168738 B)"
HOME_HTML="$(curl -s "$B/")"
case "$HOME_HTML" in *'rel="preload"'*'as="image"'*'hero-'*) echo "   !! preload-ul redundant pe arta hero a revenit" ;; *) echo "   fara preload redundant pe arta hero = da" ;; esac
case "$HOME_HTML" in *'preconnect'*'media-amazon.com'*) echo "   preconnect la hostul coperților = da" ;; *) echo "   !! lipseste preconnect-ul la m.media-amazon.com" ;; esac
# AVIF: primul format din <picture>. Verificam pe live ca se serveste cu tipul
# corect si ca e chiar mai mic decat WebP-ul (altfel nu-si are rost).
AVIF_B="$(curl -s -o /dev/null -w '%{size_download}' "$B/assets/img/hero-1.avif")"
WEBP_B="$(curl -s -o /dev/null -w '%{size_download}' "$B/assets/img/hero-1.webp")"
AVIF_CT="$(curl -s -o /dev/null -w '%{content_type}' "$B/assets/img/hero-1.avif")"
echo "   hero-1.avif: $AVIF_B B ($AVIF_CT) · hero-1.webp: $WEBP_B B (inainte de runda 3: 168738 B jpg)"
case "$HOME_HTML" in *'image/avif'*'image/webp'*) echo "   picture cu AVIF + WebP in HTML = da" ;; *) echo "   !! lipseste <picture> cu formatele" ;; esac
# Bundle-ul trebuie sa fie IDENTIC cu si fara ?v=: daca diferă, cineva serveste
# o copie veche de la margine (si un vizitator nou poate primi cod vechi).
H1="$(curl -s "$B/assets/js/page-index.js" | md5sum | cut -d' ' -f1)"
H2="$(curl -s "$B/assets/js/page-index.js?v=1" | md5sum | cut -d' ' -f1)"
if [ -n "$H1" ] && [ "$H1" = "$H2" ]; then echo "   acelasi bundle cu si fara ?v= = da (${H1})"; else echo "   !! bundle diferit cu/fara ?v= ($H1 vs $H2) - copie veche la margine?"; fi

echo
echo "── 20. buget: poll adaptiv publicat + pulse inca viu (redeploy)"
# Markerul e un string din JS (supravietuieste minificarii; numele de functii nu).
# Daca lipseste, live-ul inca ruleaza poll-ul fix de 60s/90s.
CHUNK20="$(curl -s "$B/assets/js/page-index.js" | grep -oE 'c-[A-Za-z0-9_-]+\.js' | head -1)"
if [ -n "$CHUNK20" ]; then
  HIT="$(curl -s "$B/assets/js/$CHUNK20" | grep -c 'auk-adaptive' || true)"
  echo "   chunk $CHUNK20 contine auk-adaptive: $HIT (trebuie >= 1)"
else
  echo "   !! nu am gasit chunk-ul comun (code splitting inactiv?)"
fi
echo "   /api/pulse: $(curl -s "$B/api/pulse" | head -c 180)"
echo


# ── 21. CANARUL DE PROGRES (watch_progress: D1 vs Turso) ──────────────
# Etapa de mutare a progresului de vizionare. Dovada nu vine din API, ci
# din AMBELE baze citite direct: D1 prin wrangler, Turso prin
# scripts/watch-turso.mjs. Contul temporar „canarw…" se sterge la final
# (Turso NU are cascada spre users, deci curatam explicit acolo).
echo
echo "── 21. progres de vizionare: canar live + ambele baze (WATCH_STORE=${WATCH_STORE:-d1})"
WATCH_OUT="$(node cf-relay/watch-canar.mjs "$B" 2>&1)"
WATCH_RC=$?
echo "$WATCH_OUT" | sed 's/^/     /'
WC_USER="$(echo "$WATCH_OUT" | sed -n 's/^  __CANARW_USER__=//p' | head -1)"
WC_ID="$(echo "$WATCH_OUT" | sed -n 's/^  __CANARW_USER_ID__=//p' | head -1)"
WC_SEC="$(echo "$WATCH_OUT" | sed -n 's/^  __CANARW_SECONDS__=//p' | head -1)"
WC_STORE="$(echo "$WATCH_OUT" | sed -n 's/^  __CANARW_STORE__=//p' | head -1)"
if [ "$WATCH_RC" -ne 0 ]; then
  echo "   !! canarul de progres a picat (exit $WATCH_RC)"
fi
if [ -n "$WC_ID" ]; then
  echo "   D1 (watch_progress pentru canar): $(q "SELECT COUNT(*) AS n, COALESCE(SUM(seconds),0) AS secunde FROM watch_progress WHERE user_id = $WC_ID")"
  echo "   Turso (watch_progress pentru canar):"
  node scripts/watch-turso.mjs user "$WC_ID" 2>&1 | sed 's/^/     /'
  echo "   recompensa in D1 (watched_history, trebuie 1 rand): $(q "SELECT COUNT(*) AS n FROM watched_history WHERE user_id = $WC_ID")"
  echo "   puncte in D1 (trebuie 10): $(q "SELECT points FROM users WHERE id = $WC_ID")"
  case "${WATCH_STORE:-d1}" in
    turso)
      case "$(q "SELECT COUNT(*) AS n FROM watch_progress WHERE user_id = $WC_ID")" in
        *'"n":0'*) echo "   cutover confirmat: D1 nu a primit progres, iar API-ul a raportat store=$WC_STORE" ;;
        *) echo "   !! D1 a primit totusi progres desi WATCH_STORE=turso (fallback? vezi raportul de mai jos)" ;;
      esac ;;
    shadow)
      echo "   shadow: ambele baze trebuie sa arate ${WC_SEC}s pentru canar (vezi cele doua linii de mai sus)" ;;
  esac
fi
# Jurnalul de incidente: divergente, timeout-uri, fallback-uri. „Fallback"
# nu inseamna tacere — daca sunt intrari, apar aici.
if [ "${WATCH_STORE:-d1}" != "d1" ]; then
  echo "   jurnal Turso (ultimele 24h):"
  node scripts/watch-turso.mjs report --hours 24 2>&1 | sed 's/^/     /'
  echo "   total in Turso:"
  node scripts/watch-turso.mjs count 2>&1 | sed 's/^/     /'
fi
# Curatenie: contul din D1 (cascada sterge progresul D1) + randurile din Turso.
if [ -n "$WC_ID" ]; then
  node scripts/watch-turso.mjs purge-user "$WC_ID" 2>&1 | sed 's/^/     /'
fi
q "DELETE FROM users WHERE username LIKE 'canarw%'" >/dev/null
q "UPDATE site_meta SET value = (SELECT COUNT(*) FROM users) WHERE key = 'users_total'" >/dev/null
echo "   dupa curatenie: $(q "SELECT COUNT(*) AS n FROM users WHERE username LIKE 'canarw%'") conturi canarw ramase"

# ── 22. AUTENTIFICARE: schimbarea parolei + recuperarea asistata ──────
# Migrarile 0031-0033 au ajuns in productie o data cu acest pachet. Un
# ALTER/CREATE care nu s-a aplicat NU se vede din API (endpointul da 500 abia
# cand il foloseste cineva), deci citim direct schema D1 de productie.
# Verificarile de API sunt STRICT read-only: nu creeaza conturi si nu emit
# coduri. Un cont inexistent trebuie sa primeasca acelasi raspuns ca unul real
# (fara enumerare) — daca cineva strica asta, se vede aici, nu intr-un raport
# de securitate.
echo
echo "── 22. autentificare: schimbarea parolei + recuperarea asistata (migrarile 0031-0033)"
echo "   users.auth_version exista: $(q "SELECT COUNT(*) AS n FROM pragma_table_info('users') WHERE name = 'auth_version'")"
echo "   tabelul password_reset_requests: $(q "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'password_reset_requests'")"
echo "   index un singur cod activ/cont: $(q "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_password_reset_one_active_per_user'")"
echo "   index ultima vizionare (0033): $(q "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_watched_user_recent'")"
echo "   coduri stocate in clar (trebuie 0): $(q "SELECT COUNT(*) AS n FROM password_reset_requests WHERE token_hash <> '' AND length(token_hash) < 32")"
echo "   /reset-password → $(curl -s -o /dev/null -w '%{http_code}' "$B/reset-password") (trebuie 200)"
case "$(curl -s "$B/login")" in *reset-password*) echo "   link de recuperare (Ai uitat parola) pe /login = da" ;; *) echo "   !! lipseste linkul de recuperare de pe /login" ;; esac
echo "   POST /api/auth/password fara sesiune → $(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/auth/password" -H 'Content-Type: application/json' -H "Origin: $B" -d '{}') (trebuie 401)"
echo "   GET /api/admin/password-resets anonim → $(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/password-resets") (trebuie 401)"
# Anti-enumerare: cheia corecta din body e `identifier` (sau email/username).
# Un cont inexistent TREBUIE sa primeasca 202 + acelasi mesaj generic ca unul
# real; orice alt cod face din formular un oracle pentru adresele membrilor.
RESET_INEXISTENT="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/auth/password-reset" -H 'Content-Type: application/json' -H "Origin: $B" -d '{"identifier":"canar-inexistent-fara-cont"}')"
echo "   POST /api/auth/password-reset pe un cont inexistent → ${RESET_INEXISTENT} (trebuie 202, fara enumerare)"
case "$(curl -s -X POST "$B/api/auth/password-reset" -H 'Content-Type: application/json' -H "Origin: $B" -d '{"identifier":"canar-inexistent-fara-cont"}')" in
  *'Dacă există un cont'*) echo "   mesaj generic identic pentru conturi inexistente = da" ;;
  *) echo "   !! raspunsul difera de mesajul generic (risc de enumerare)" ;;
esac
echo "   corp fara camp de existenta: $(curl -s -X POST "$B/api/auth/password-reset" -H 'Content-Type: application/json' -H "Origin: $B" -d '{"identifier":"canar-inexistent-fara-cont"}' | head -c 160)"
echo "   cereri de resetare in coada dupa verificare: $(q "SELECT COUNT(*) AS n FROM password_reset_requests WHERE status IN ('pending','issued')")"

# ── 23. NOUTATI: jurnalul primei pagini (migrarea 0034) ──────────────
# Sectiunea „Noutati" e alimentata din tabelul `news`. Stirile automate se
# scriu in acelasi batch D1 cu evenimentul (serie noua, tema de sezon), deci
# daca migrarea nu s-a aplicat, ADAUGAREA UNEI SERII ar cadea cu totul — nu
# doar jurnalul. De aceea verificam intai schema, direct in D1.
# Totul e read-only: nu scriem nicio stire de pe relay.
echo
echo "── 23. noutati: jurnalul primei pagini (migrarea 0034)"
echo "   tabelul news exista: $(q "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'news'")"
echo "   index de citire (created_at DESC): $(q "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_news_recent'")"
echo "   stiri in jurnal: $(q "SELECT COUNT(*) AS n FROM news")"
echo "   tipuri folosite: $(q "SELECT kind, COUNT(*) AS n FROM news GROUP BY kind")"
echo "   linkuri externe scapate in jurnal (trebuie 0): $(q "SELECT COUNT(*) AS n FROM news WHERE link <> '' AND link NOT LIKE '/%'")"
echo "   GET /api/news public → $(curl -s -o /dev/null -w '%{http_code}' "$B/api/news") (trebuie 200)"
echo "   corp: $(curl -s "$B/api/news" | head -c 200)"
echo "   POST /api/admin/news anonim → $(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/admin/news" -H 'Content-Type: application/json' -H "Origin: $B" -d '{"title":"canar"}') (trebuie 401)"
echo "   GET /api/admin/news anonim → $(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/news") (trebuie 401)"
case "$(curl -s "$B/api/home")" in *'"news"'*) echo "   /api/home livreaza si noutatile = da" ;; *) echo "   !! /api/home nu mai contine cheia news" ;; esac
case "$(curl -s "$B/")" in *news-section*) echo "   sectiunea Noutati e in prima pagina = da" ;; *) echo "   !! lipseste sectiunea Noutati din prima pagina" ;; esac

# ── 24. MODERAREA CHATULUI (migrarea 0035) ───────────────────────────
# Coloana `mid` e conditia ca stergerea unui mesaj sa functioneze: fara ea,
# un mesaj ajuns in arhiva nu mai poate fi legat de cel afisat in pagina.
# Verificam si ca modul lent nu e accesibil fara drept de moderare.
echo
echo "── 24. moderarea chatului live (migrarea 0035)"
echo "   chat_messages.mid exista: $(q "SELECT COUNT(*) AS n FROM pragma_table_info('chat_messages') WHERE name = 'mid'")"
echo "   index pe mid: $(q "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_chat_mid'")"
echo "   mesaje in arhiva: $(q "SELECT COUNT(*) AS n FROM chat_messages")"
echo "   GET /api/admin/chat-slow anonim → $(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/chat-slow") (trebuie 401)"
echo "   POST /api/admin/chat-slow anonim → $(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/admin/chat-slow" -H 'Content-Type: application/json' -H "Origin: $B" -d '{"seconds":10}') (trebuie 401)"
echo "   actiuni de moderare in jurnal: $(q "SELECT COUNT(*) AS n FROM admin_log WHERE action LIKE 'chat_%'")"

# ── 25. SEO: pagini de gen indexabile (/gen/<slug>) ──────────────────
# Prima pagina de aterizare reala pentru „anime <gen> subtitrat in romana".
# Verificam pe LIVE ce vede un crawler: status, titlu, canonical, date
# structurate, linkuri catre serii in HTML si prezenta in sitemap. Slugul
# se ia din primul gen din catalog, ca sa nu depindem de date fixe.
echo
echo "── 25. SEO: pagini de gen indexabile (/gen/<slug>)"
GEN_SLUG="$(curl -s "$B/sitemap.txt" | grep -o '/gen/[a-z0-9-]*' | head -n1 | sed 's|/gen/||')"
echo "   genuri in sitemap: $(curl -s "$B/sitemap.txt" | grep -c '/gen/')"
if [ -n "$GEN_SLUG" ]; then
  echo "   gen verificat: $GEN_SLUG"
  GEN_HTML="$(curl -s "$B/gen/$GEN_SLUG")"
  echo "   GET /gen/$GEN_SLUG → $(curl -s -o /dev/null -w '%{http_code}' "$B/gen/$GEN_SLUG") (trebuie 200)"
  echo "   titlu: $(printf '%s' "$GEN_HTML" | grep -o '<title>[^<]*' | head -c 120)"
  case "$GEN_HTML" in *'"CollectionPage"'*) echo "   date structurate CollectionPage = da" ;; *) echo "   !! lipseste CollectionPage" ;; esac
  case "$GEN_HTML" in *'"BreadcrumbList"'*) echo "   breadcrumb pentru Google = da" ;; *) echo "   !! lipseste BreadcrumbList" ;; esac
  case "$GEN_HTML" in *'id="gen-ssr"'*) echo "   linkuri catre serii randate pe server = da" ;; *) echo "   !! lipsesc linkurile randate pe server" ;; esac
  case "$GEN_HTML" in *"/gen/$GEN_SLUG"*) echo "   canonical pe pagina de gen = da" ;; *) echo "   !! canonical gresit" ;; esac
else
  echo "   !! niciun gen in sitemap (catalogul nu are genuri completate?)"
fi
echo "   gen inexistent → $(curl -s -o /dev/null -w '%{http_code}' "$B/gen/gen-inexistent-canar") (trebuie 404)"
echo "   robots.txt permite /gen: $(curl -s "$B/robots.txt" | grep -c '^Allow: /gen')"
case "$(curl -s "$B/serie/1014")" in *'"BreadcrumbList"'*) echo "   pagina de serie are breadcrumb = da" ;; *) echo "   !! pagina de serie fara breadcrumb" ;; esac

echo "════════ AUDIT LIVE ════════"
node scripts/audit-live.mjs "$B"
echo "exit audit: $?"

echo
echo "════════ CONSUM COTE GRATUITE (azi, UTC) ════════"
node scripts/usage.mjs
echo "exit usage: $?"
