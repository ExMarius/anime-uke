#!/usr/bin/env bash
set -uo pipefail
echo "── deploy fix poza seriei ──"
./deploy.sh
echo "exit deploy: $?"
echo "── JS-ul servit: optimizare IMDb nativă, zero weserv ──"
curl -s "https://anime-uke.pages.dev/assets/js/core.js?cb=$RANDOM" | grep -o "FMjpg_UX" | head -1
curl -s "https://anime-uke.pages.dev/assets/js/core.js?cb=$RANDOM" | grep -c "weserv" || true
echo "── page-index: trepte de eroare ──"
curl -s "https://anime-uke.pages.dev/assets/js/page-index.js?cb=$RANDOM" | grep -o "heroErr" | head -1
echo "── pagini ──"
for u in / /serie/1014; do echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev$u)"; done
