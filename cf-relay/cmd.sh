#!/usr/bin/env bash
set -uo pipefail
echo "── deploy LCP + preconnect + WAAPI ──"
./deploy.sh
echo "exit deploy: $?"
echo "── modulepreload + preconnect în HTML ──"
curl -s https://anime-uke.pages.dev/ | grep -c "modulepreload"
curl -s https://anime-uke.pages.dev/ | grep -o 'preconnect" href="[^"]*"' | head -1
echo "── optimizeCover în JS-ul servit ──"
curl -s "https://anime-uke.pages.dev/assets/js/core.js" | grep -c "weserv" || true
echo "── pagini ──"
for u in / /series /episode /login /admin/serii; do
  echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev$u)"
done
