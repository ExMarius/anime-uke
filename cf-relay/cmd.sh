#!/usr/bin/env bash
set -uo pipefail
./deploy.sh
echo "exit deploy: $?"

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
echo "  prima pagina → $(curl -s -o /dev/null -w '%{http_code}' "$B/")  · /api/pulse → $(curl -s "$B/api/pulse")"
