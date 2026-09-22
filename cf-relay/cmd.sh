#!/usr/bin/env bash
set -uo pipefail

# =====================================================================
# Relay: deploy + verificare pe live a „buget 0" (buget de invocări).
#   - assetele/paginile publice statice NU mai trec prin worker
#   - Cache-Control pentru JS/CSS vine din public/_headers (immutable)
#   - prima pagină = o singură cerere de API (/api/home)
# =====================================================================

./deploy.sh
echo "exit deploy: $?"

B="https://anime-uke.pages.dev"
V="$(git rev-parse --short HEAD)"
echo
echo "════════ verificări punctuale BUGEte (commit $V) ════════"

hr() { echo "── $1"; }

hr "1. asset static: Cache-Control trebuie să fie 'public, max-age=31536000, immutable', O SINGURĂ valoare"
curl -sI "$B/assets/css/style.css?v=$V" | grep -i '^cache-control' | tr -d '\r'
echo "   (înainte de _routes.json ieșea 'no-cache, no-cache' = assetul trecea și prin worker)"

hr "2. asset static: headerele de securitate vin din public/_headers (așteptat 5)"
curl -sI "$B/assets/css/style.css?v=$V" \
  | grep -icE '^(content-security-policy|x-frame-options|permissions-policy|strict-transport-security|cross-origin-resource-policy)'

hr "3. pagina principală: headere de securitate + HSTS"
curl -sI "$B/" | grep -iE '^(content-security-policy|strict-transport-security|permissions-policy|x-frame-options)' | tr -d '\r' | cut -c1-90

hr "4. poarta de autentificare încă funcționează (ce NU e în _routes.json)"
for p in /profile /admin /shop /admin/serii; do
  echo "   $p → $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B$p") (așteptat 302 /login?next=…)"
done

hr "5. SSR + 404 real pe serie/episod (rutele care trec prin worker)"
echo "   /serie/99999999 → $(curl -s -o /dev/null -w '%{http_code}' "$B/serie/99999999") (404)"
echo "   /episod/99999999 → $(curl -s -o /dev/null -w '%{http_code}' "$B/episod/99999999") (404)"
echo "   /series → $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/series") (301 spre /)"
echo "   /package.json → $(curl -s -o /dev/null -w '%{http_code}' "$B/package.json") (404)"

hr "6. /api/home: prima pagină într-o singură cerere"
curl -s "$B/api/home" | head -c 220
echo
echo "   chei prezente: $(curl -s "$B/api/home" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(Object.keys(j).join(", "))}catch{process.stdout.write("NU E JSON")}})')"

hr "7. imagini: .webp direct + og:image rămâne .jpg (rețelele sociale nu acceptă WebP)"
echo "   hero-1.webp → $(curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}B' "$B/assets/img/hero-1.webp")"
echo "   referințe .webp în HTML: $(curl -s "$B/" | grep -c 'hero-1\.webp')"
echo "   referințe .jpg în afara og/twitter: $(curl -s "$B/" | grep -v 'og:image\|twitter:image' | grep -c 'hero-1\.jpg')"

hr "8. assete versionate în HTML (deploy.sh a aplicat ?v=$V)"
echo "   referințe ?v=: $(curl -s "$B/" | grep -o 'assets/js/[A-Za-z0-9_.-]*\.js?v=[A-Za-z0-9_.-]*' | head -3 | tr '\n' ' ')"

echo
echo "════════ AUDIT LIVE ════════"
node scripts/audit-live.mjs "$B"
echo "exit audit: $?"

echo
echo "════════ CONSUM COTE GRATUITE (azi, UTC) ════════"
node scripts/usage.mjs
echo "exit usage: $?"
