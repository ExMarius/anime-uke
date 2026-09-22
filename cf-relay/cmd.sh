#!/usr/bin/env bash
# Deploy teme canvas: particule reale (petale/bule/stele) peste gradienti +
# verificare purge (clase noi) + prezenta motorului anim-bg.js pe productie.
set -uo pipefail
./deploy.sh
echo "exit deploy: $?"
# Propagarea Pages durează zeci de secunde: auditul imediat după deploy a
# prins o dată HTML vechi (titlu + ?v= din deployment-ul anterior). Așteptăm.
echo "aștept 60s propagarea…"; sleep 60

echo
echo "=== AUDIT LIVE dupa deploy ==="
node scripts/audit-live.mjs https://anime-uke.pages.dev
echo "exit audit: $?"

B="https://anime-uke.pages.dev"
echo
echo "=== verificari punctuale (fix-urile din audit) ==="
echo "  /serie/99999999 → $(curl -s -o /tmp/nf.html -w '%{http_code}' "$B/serie/99999999") (trebuie 404)"
echo "    X-Robots-Tag: $(curl -sI "$B/serie/99999999" | grep -i '^x-robots-tag' | tr -d '\r')"
echo "    titlu: $(grep -oE '<title>[^<]*</title>' /tmp/nf.html | head -1)"
echo "  /episod/99999999 → $(curl -s -o /dev/null -w '%{http_code}' "$B/episod/99999999") (trebuie 404)"
echo "  /series → $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/series") (trebuie 301 spre /)"
echo "  /series?id=1014 → $(curl -s -o /dev/null -w '%{http_code}' "$B/series?id=1014") (trebuie 200)"
echo "  /series/ → $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/series/") (trebuie 301 spre /)"
echo "  /package.json → $(curl -s -o /dev/null -w '%{http_code}' "$B/package.json") (trebuie 404, nu 302)"
echo "  /AGENTS.md → $(curl -s -o /dev/null -w '%{http_code}' "$B/AGENTS.md") (trebuie 404)"
echo "  /deploy.sh → $(curl -s -o /dev/null -w '%{http_code}' "$B/deploy.sh") (trebuie 404)"
echo "  /src/worker.js → $(curl -s -o /dev/null -w '%{http_code}' "$B/src/worker.js") (trebuie 404)"
echo "  /ruta-inexistenta → $(curl -s -o /dev/null -w '%{http_code}' "$B/ruta-inexistenta") (trebuie 404)"
echo "  /profile (nelogat) → $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/profile") (trebuie 302 spre /login)"
echo "  /profile.html (nelogat) → $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/profile.html") (302 spre /login e ok)"
echo "  /login noindex: $(curl -s "$B/login" | grep -c 'noindex')  canonical: $(curl -s "$B/login" | grep -c 'rel="canonical"')"
echo "  /register noindex: $(curl -s "$B/register" | grep -c 'noindex')  canonical: $(curl -s "$B/register" | grep -c 'rel="canonical"')"
echo "  CORP header: $(curl -sI "$B/" | grep -i '^cross-origin-resource-policy' | tr -d '\r')"
echo "  sitemap conține /series? (trebuie 0): $(curl -s "$B/sitemap.xml" | grep -c '<loc>[^<]*/series</loc>')"
echo "  sitemap URL-uri: $(curl -s "$B/sitemap.xml" | grep -oE '<loc>[^<]*</loc>' | tr '\n' ' ')"
echo "  /serie/1014 (serie reala) → $(curl -s -o /dev/null -w '%{http_code}' "$B/serie/1014") (trebuie 200)"
echo "  /episod/4210 (episod real) → $(curl -s -o /dev/null -w '%{http_code}' "$B/episod/4210") (trebuie 200)"
echo "  SSR episod /episod/4210:"
curl -s "$B/episod/4210" -o /tmp/ep.html
echo "    titlu: $(grep -oE '<title>[^<]*</title>' /tmp/ep.html | head -1)"
echo "    description: $(grep -c 'meta name="description"' /tmp/ep.html)  canonical: $(grep -c 'rel="canonical"' /tmp/ep.html)  video.episode: $(grep -c 'video.episode' /tmp/ep.html)"
echo "    TVEpisode: $(grep -c 'TVEpisode' /tmp/ep.html)  BreadcrumbList: $(grep -c 'BreadcrumbList' /tmp/ep.html)  partOfTVSeries: $(grep -c 'partOfTVSeries' /tmp/ep.html)"
echo "    titlu generic ramas? (trebuie 0): $(grep -c '<title>Episod • anime-uke</title>' /tmp/ep.html)"
echo "=== verificari punctuale (runda fix-uri: CSP, pulse, rute moarte) ==="
echo "  CSP: $(curl -sI "$B/" | grep -i '^content-security-policy' | tr -d '\r' | cut -c1-160)"
echo "  HSTS pe API: $(curl -sI "$B/api/pulse" | grep -i '^strict-transport-security' | tr -d '\r')"
echo "  /404 (nelogat) → $(curl -s -o /dev/null -w '%{http_code}' "$B/404") (trebuie 404, nu 302)"
echo "  /admin/serie (bare) → $(curl -s -o /dev/null -w '%{http_code}' "$B/admin/serie") (trebuie 404)"
echo "  /covers/x.png → $(curl -s -o /tmp/cv.html -w '%{http_code}' "$B/covers/x.png") + pagina site-ului: $(grep -c 'Mergi la catalog' /tmp/cv.html)"
echo "  robots Allow: /series? (trebuie 0): $(curl -s "$B/robots.txt" | grep -c 'Allow: /series')"
echo "  speculationrules prerender: $(curl -s "$B/speculationrules.json" | python3 -c "import sys,json; print(json.load(sys.stdin)['prerender'][0]['where'])")"
echo "  prima pagina → $(curl -s -o /dev/null -w '%{http_code}' "$B/")  · /api/pulse → $(curl -s "$B/api/pulse")"
echo "  ?v= din / (trebuie build-ul curent): $(curl -s "$B/" | grep -oE '\?v=[A-Za-z0-9._-]+' | sort -u | tr '\n' ' ')"
echo "=== verificari punctuale (logo V7) ==="
echo "  /assets/img/logo.png → $(curl -s -o /dev/null -w '%{http_code}' "$B/assets/img/logo.png") (trebuie 200)"
echo "  /assets/img/logo-icon.png → $(curl -s -o /dev/null -w '%{http_code}' "$B/assets/img/logo-icon.png") (trebuie 200)"
echo "  negociere webp logo: $(curl -s -o /dev/null -D - -H 'Accept: image/webp' "$B/assets/img/logo-icon.png" | grep -i '^content-type' | tr -d '\r') (trebuie image/webp)"
echo "  favicon logo în /login: $(curl -s "$B/login" | grep -c 'rel="icon" href="/assets/img/logo-icon.png"') (trebuie 1)"
echo "  og:image logo în /: $(curl -s "$B/" | grep -c 'og:image" content="https://anime-uke.pages.dev/assets/img/logo.png"') (trebuie 1)"
echo "  marca auth logo în /register: $(curl -s "$B/register" | grep -c 'auth-logo__mark" src="/assets/img/logo-icon.png"') (trebuie 1)"
echo "  JS bundle conține logo-icon (navbar): $(curl -s "$B/assets/js/page-index.js?v=$(curl -s "$B/" | grep -oE 'page-index.js\?v=[A-Za-z0-9._-]+' | head -1 | cut -d= -f2)" | grep -c 'logo-icon.png') (trebuie ≥1)"
echo "=== verificari punctuale (favicon Google) ==="
echo "  /favicon.ico → $(curl -s -o /tmp/fi.ico -w '%{http_code} %{size_download}B' "$B/favicon.ico") (trebuie 200 si >4000B, nu iconita Cloudflare)"
echo "  /favicon.ico content-type: $(curl -s -o /dev/null -D - "$B/favicon.ico" | grep -i '^content-type' | tr -d '\r') (trebuie image/x-icon)"
echo "  /apple-touch-icon.png → $(curl -s -o /dev/null -w '%{http_code} %{size_download}B %{content_type}' "$B/apple-touch-icon.png") (trebuie 200 PNG)"
echo "=== verificari punctuale (sitemap-uri GSC) ==="
echo "  /sitemap.xml → $(curl -s -o /tmp/sm.xml -w '%{http_code} %{content_type}' "$B/sitemap.xml") (trebuie 200 text/xml)"
echo "    URL-uri: $(grep -c '<loc>' /tmp/sm.xml) · episoade: $(grep -c '/episod/' /tmp/sm.xml) · CORP prezent? (trebuie 0): $(curl -s -o /dev/null -D - "$B/sitemap.xml" | grep -ci '^cross-origin-resource-policy')"
echo "  /sitemap.txt → $(curl -s -o /tmp/sm.txt -w '%{http_code} %{content_type}' "$B/sitemap.txt") (trebuie 200 text/plain)"
echo "    linii: $(wc -l < /tmp/sm.txt) · prima: $(head -1 /tmp/sm.txt)"
echo "  /sitemap (fara extensie) → $(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$B/sitemap") (trebuie 200 text/xml)"
echo "  //sitemap.xml (slash dublu) → $(curl -s -o /dev/null -w '%{http_code}' "$B//sitemap.xml") (trebuie 200)"
echo "  cu UA Googlebot: $(curl -s -o /dev/null -w '%{http_code}' -A 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' "$B/sitemap.xml") (trebuie 200)"
echo "=== inspectie bytes sitemap (GSC 'nu a putut fi citit') ==="
curl -s -D /tmp/sm.hdr -o /tmp/sm.bin "$B/sitemap.xml"
echo "--- headere complete ---"; tr -d '\r' < /tmp/sm.hdr
echo "--- primii 120 bytes (hex+text, trebuie sa inceapa cu 3c 3f 78 6d = '<?xm') ---"; head -c 120 /tmp/sm.bin | od -A d -t x1z
echo "--- ultimii 60 bytes ---"; tail -c 60 /tmp/sm.bin | od -A d -t x1z
echo "--- validare XML stricta (expat, acelasi parser ca la Google) ---"; python3 -c "import xml.parsers.expat; p=xml.parsers.expat.ParserCreate(); p.Parse(open('/tmp/sm.bin','rb').read(), True); print('EXPAT: XML VALID')"
echo "--- marime corp ---"; wc -c < /tmp/sm.bin
echo "--- fara compresie (Accept-Encoding: identity) → compara bytes ---"; curl -s -H 'Accept-Encoding: identity' -o /tmp/sm2.bin "$B/sitemap.xml"; cmp -s /tmp/sm.bin /tmp/sm2.bin && echo IDENTIC || echo DIFERIT
echo "--- txt: fiecare linie e URL pe domeniul nostru? ---"; python3 -c "lines=open('/tmp/sm.txt').read().split(chr(10)); bad=[l for l in lines if l and not l.startswith('https://anime-uke.pages.dev/')]; print('linii:', len(lines), '| invalide:', bad if bad else 'NICIUNA')"
echo "=== verificari punctuale (shop 2.0) ==="
W="npx wrangler"; [ -x "$PWD/node_modules/.bin/wrangler" ] && W="$PWD/node_modules/.bin/wrangler"
$W d1 execute DB --remote --command "SELECT xp_boost_until FROM users LIMIT 1" >/dev/null 2>&1 \
  && echo "  migrare 0026: coloana xp_boost_until exista pe D1 productie" \
  || echo "  migrare 0026: LIPSESTE coloana xp_boost_until de pe productie!"
V=$(curl -s "$B/" | grep -oE '[a-z-]+\.(css|js)\?v=[A-Za-z0-9._-]+' | head -1 | cut -d= -f2)
curl -s "$B/assets/css/style.css?v=$V" -o /tmp/st.css
echo "  css (purge): nc-sunset=$(grep -c 'nc-sunset' /tmp/st.css) theme-sakura=$(grep -c 'theme-sakura' /tmp/st.css) theme-royal=$(grep -c 'theme-royal' /tmp/st.css) anim-sunset=$(grep -c 'theme-sunset' /tmp/st.css) anim-aurora=$(grep -c 'theme-aurora' /tmp/st.css) anim-ocean=$(grep -c 'theme-ocean' /tmp/st.css) anim-petale=$(grep -c 'theme-petale' /tmp/st.css) anim-portocaliu=$(grep -c 'theme-portocaliu' /tmp/st.css) keyframes: $(grep -o '@keyframes theme-[a-z-]*' /tmp/st.css | sort -u | tr '\n' ' ') (trebuie 3 nume)"
curl -s "$B/assets/js/anim-bg.js?v=$V" -o /tmp/ab.js
echo "  motor canvas: rAF=$(grep -c 'requestAnimationFrame' /tmp/ab.js) id=$(grep -c 'anim-bg' /tmp/ab.js) petale=$(grep -c 'petale' /tmp/ab.js) bule=$(grep -c 'bule' /tmp/ab.js) stele=$(grep -c 'stele' /tmp/ab.js) portocaliu=$(grep -c 'portocaliu' /tmp/ab.js) (toate >=1; siruri care supravietuiesc minificarii)"
curl -s "$B/assets/js/page-shop.js?v=$V" -o /tmp/ps.js
echo "  bundle shop: shop-boost=$(grep -c 'shop-boost' /tmp/ps.js) reward_text=$(grep -c 'reward_text' /tmp/ps.js) nc-sunset=$(grep -c 'nc-sunset' /tmp/ps.js) (toate ≥1)"
curl -s "$B/assets/js/page-profile.js?v=$V" -o /tmp/pp.js
echo "  bundle profil: use_token=$(grep -c 'use_token' /tmp/pp.js) (≥1)"

echo "=== diagnostic cache + bundle (teme canvas) ==="
echo "  head /shop: $(curl -sI "$B/shop" | grep -i '^cache-control' | tr -d '\r')"
echo "  head / (html): $(curl -sI "$B/" | grep -i '^cache-control' | tr -d '\r')"
VS=$(curl -s "$B/shop" | grep -oE 'page-shop\.js\?v=[A-Za-z0-9._-]+' | head -1 | cut -d= -f2)
echo "  ?v= live (/shop): $VS"
echo "  bundle live: anim-bg=$(grep -c 'anim-bg' /tmp/ps.js) petale=$(grep -c 'petale' /tmp/ps.js) bule=$(grep -c 'bule' /tmp/ps.js) stele=$(grep -c 'stele' /tmp/ps.js) garda=$(grep -c '?v=' /tmp/ps.js) (toate >=1 = motorul + garda anti-cache sunt in bundle-ul din productie)"

echo "=== verificari punctuale (admin economie) ==="
echo "  GET /api/admin/users anonim → $(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/users") (trebuie 401)"
echo "  /admin anonim → $(curl -s -o /dev/null -w '%{http_code}' "$B/admin") (trebuie 302 catre /login)"
