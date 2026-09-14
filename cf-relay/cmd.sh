#!/usr/bin/env bash
set -uo pipefail
echo "page-index bundle: UX-sufix IMDb: $(curl -s "https://anime-uke.pages.dev/assets/js/page-index.js?cb=$RANDOM" | grep -o 'FMjpg_UX' | wc -l)"
echo "page-index bundle: artă de rezervă: $(curl -s "https://anime-uke.pages.dev/assets/js/page-index.js?cb=$RANDOM" | grep -o 'hero-1.jpg' | wc -l)"
echo "core: UX400 prezent: $(curl -s "https://anime-uke.pages.dev/assets/js/core.js?cb=$RANDOM" | grep -o '_V1_FMjpg_UX' | wc -l)"
