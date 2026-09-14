#!/usr/bin/env bash
set -uo pipefail
echo "── deploy shop culori + teme ──"
./deploy.sh
echo "exit deploy: $?"
echo "── migrația 0020 aplicată ──"
grep -E "0020|Schema" /tmp/deploy.log 2>/dev/null | head -3 || true
echo "── API shop: culori + teme în catalog ──"
curl -s "https://anime-uke.pages.dev/api/shop" -o /dev/null -w "shop (401 pt anonim e OK): %{http_code}\n"
echo "── paginile servesc codul nou ──"
JS=$(curl -s "https://anime-uke.pages.dev/assets/js/page-shop.js?cb=$RANDOM")
echo "activate în shop: $(echo "$JS" | grep -o "shop/activate" | wc -l)"
echo "paintColors: $(echo "$JS" | grep -o "paintColors" | wc -l)"
CSS=$(curl -s "https://anime-uke.pages.dev/assets/css/style.css?cb=$RANDOM")
echo "nc-rainbow în CSS: $(echo "$CSS" | grep -o "nc-rainbow" | wc -l)"
echo "tema mizukage în CSS: $(echo "$CSS" | grep -o "theme-mizukage" | wc -l)"
echo "── shop.html are gridurile ──"
curl -s "https://anime-uke.pages.dev/shop?cb=$RANDOM" | grep -o 'id="colors-grid"\|id="themes-grid"' | sort | uniq -c
echo "── pagini ──"
for u in / /shop /profile; do echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev$u)"; done
