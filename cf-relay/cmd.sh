#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
W="$PWD/node_modules/.bin/wrangler"
[ -x "$W" ] || W="npx wrangler"
echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"
echo "── rank_themes (trebuie 22) ──"
$W d1 execute anime-db --remote --json --command "SELECT COUNT(*) AS n FROM rank_themes" 2>/dev/null | grep -A2 '"results"' | head -6
$W d1 execute anime-db --remote --json --command "SELECT slug FROM rank_themes ORDER BY slug" 2>/dev/null | grep -o '"slug": "[^"]*"' | head -30
echo "── client servit ──"
JS=$(curl -s "https://anime-uke.pages.dev/assets/js/page-profile.js")
echo "lista tari (Guinea-Bissau): $(echo "$JS" | grep -o "Guinea-Bissau" | wc -l)"
echo "panou facțiune: $(echo "$JS" | grep -o "faction__grid" | wc -l)"
curl -s -o /dev/null -w "api factions anon: %{http_code}\n" "https://anime-uke.pages.dev/api/factions"
