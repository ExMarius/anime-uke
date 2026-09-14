#!/usr/bin/env bash
set -uo pipefail
for D in "https://anime-uke.pages.dev" "https://c08220c9.anime-uke.pages.dev"; do
  JS=$(curl -s "$D/assets/js/page-profile.js")
  echo "[$D] tari: $(echo "$JS" | grep -o 'Guinea-Bissau' | wc -l), facțiuni: $(echo "$JS" | grep -o 'faction__grid' | wc -l)"
done
