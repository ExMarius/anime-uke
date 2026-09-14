#!/usr/bin/env bash
set -uo pipefail
echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"
echo "── JS servit ──"
JS=$(curl -s "https://anime-uke.pages.dev/assets/js/page-index.js?cb=$RANDOM")
echo "sort=latest: $(echo "$JS" | grep -o 'sort=latest' | head -1)"
echo "card__meta:  $(echo "$JS" | grep -o 'card__meta' | head -1)"
echo "── CSS servit ──"
curl -s "https://anime-uke.pages.dev/assets/css/style.css?cb=$RANDOM" | grep -o 'card__meta .pill-pos{position:static' | head -1
echo "── pagini ──"
for u in / /series; do echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev$u)"; done
