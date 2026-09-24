#!/usr/bin/env bash
# =====================================================================
# Deploy + verificare LIVE, după integrarea celor două linii de lucru:
#   (a) feature-urile din PR #4 (SSR SEO episod, logo, teme de sezon,
#       shop 2.0, sitemap-uri GSC, garda anti-cache);
#   (b) bugetul de invocări din sesiunea „buget 0": public/_routes.json
#       (assetele și paginile publice statice NU mai trec prin worker),
#       /api/home (prima pagină într-o singură cerere), imagini .webp
#       directe, Cache-Control immutable din public/_headers.
#
# Lecție păstrată: propagarea Pages durează zeci de secunde — se așteaptă
# înainte de audit, altfel se verifică deployment-ul anterior.
# =====================================================================
set -uo pipefail
./deploy.sh
echo "exit deploy: $?"
echo "aștept 60s propagarea…"; sleep 60

B="https://anime-uke.pages.dev"
V="$(git rev-parse --short HEAD)"
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
case "$HOME_HTML" in *'as="image" href="/assets/img/hero-1.webp"'*) echo "   !! preload-ul redundant pe arta hero a revenit" ;; *) echo "   fara preload redundant pe arta hero = da" ;; esac
case "$HOME_HTML" in *'preconnect'*'media-amazon.com'*) echo "   preconnect la hostul coperților = da" ;; *) echo "   !! lipseste preconnect-ul la m.media-amazon.com" ;; esac
# Bundle-ul trebuie sa fie IDENTIC cu si fara ?v=: daca diferă, cineva serveste
# o copie veche de la margine (si un vizitator nou poate primi cod vechi).
H1="$(curl -s "$B/assets/js/page-index.js" | md5sum | cut -d' ' -f1)"
H2="$(curl -s "$B/assets/js/page-index.js?v=1" | md5sum | cut -d' ' -f1)"
if [ -n "$H1" ] && [ "$H1" = "$H2" ]; then echo "   acelasi bundle cu si fara ?v= = da (${H1})"; else echo "   !! bundle diferit cu/fara ?v= ($H1 vs $H2) - copie veche la margine?"; fi

echo
echo "════════ AUDIT LIVE ════════"
node scripts/audit-live.mjs "$B"
echo "exit audit: $?"

echo
echo "════════ CONSUM COTE GRATUITE (azi, UTC) ════════"
node scripts/usage.mjs
echo "exit usage: $?"
