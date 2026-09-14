#!/usr/bin/env bash
set -uo pipefail
D="https://9d5196e7.anime-uke.pages.dev"
JS=$(curl -s "$D/assets/js/page-profile.js")
echo "client facțiuni (deployment final): $(echo "$JS" | grep -o "faction__grid" | wc -l)"
echo "client chat lider: $(curl -s "$D/assets/js/chat.js" | grep -o "leader_color" | wc -l)"
curl -s -o /dev/null -w "api factions: %{http_code}\n" "https://anime-uke.pages.dev/api/factions"
