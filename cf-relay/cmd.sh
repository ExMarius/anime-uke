#!/usr/bin/env bash
set -uo pipefail
for U in "https://anime-uke.pages.dev" "https://anime-uke.pages.dev"; do
  JS=$(curl -s "$U/assets/js/page-profile.js")
  echo "[$U] js taburi: $(echo "$JS" | grep -o 'initProfileTabs' | wc -l), facțiuni: $(echo "$JS" | grep -o 'faction__grid' | wc -l), țări: $(echo "$JS" | grep -o 'Guineea-Bissau' | wc -l)"
done
HTML=$(curl -s "https://anime-uke.pages.dev/assets/css/page-user.css")
echo "pane css: $(echo "$HTML" | grep -o 'data-pane\|\.ptab ' | wc -l)"
