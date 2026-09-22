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

echo
echo "════════ AUDIT LIVE ════════"
node scripts/audit-live.mjs "$B"
echo "exit audit: $?"

echo
echo "════════ CONSUM COTE GRATUITE (azi, UTC) ════════"
node scripts/usage.mjs
echo "exit usage: $?"
