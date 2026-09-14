#!/usr/bin/env bash
set -uo pipefail
D="https://107eae9b.anime-uke.pages.dev"
JS=$(curl -s "$D/assets/js/page-profile.js")
echo "panou facțiune (deployment): $(echo "$JS" | grep -o "faction__grid" | wc -l)"
echo "tocmai-lunii (deployment): $(echo "$JS" | grep -o "Bun venit în" | wc -l)"
