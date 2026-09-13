#!/usr/bin/env bash
# Deploy + verificare SEO (totul anonim/public).
set -uo pipefail
B="https://anime-uke.pages.dev"
echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"
echo ""
echo "═══ SEO VERDICT ═══"
echo "title pe /: $(curl -s "$B/" | grep -o '<title>[^<]*' | head -1)"
echo "meta desc pe /: $(curl -s "$B/" | grep -o 'name="description" content="[^"]\{0,60\}' | head -1)"
SID=$(curl -s "$B/sitemap.xml" | grep -o '/serie/[0-9]*' | head -1)
echo "sitemap primul URL: $SID"
if [ -n "$SID" ]; then
  echo "── $SID (SSR) ──"
  P=$(curl -s "$B$SID")
  echo "title: $(echo "$P" | grep -o '<title>[^<]*' | head -1)"
  echo "JSON-LD: $(echo "$P" | grep -c 'TVSeries') aparitii"
  echo "canonical: $(echo "$P" | grep -o 'rel="canonical" href="[^"]*' | head -1)"
  echo "og:image: $(echo "$P" | grep -c 'og:image')"
fi
echo "── /episod/1 -> $(curl -s -o /dev/null -w '%{http_code}' "$B/episod/1")"
echo "── sanitate: / -> $(curl -s -o /dev/null -w '%{http_code}' "$B/")"
