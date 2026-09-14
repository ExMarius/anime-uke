#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
W="$PWD/node_modules/.bin/wrangler"
[ -x "$W" ] || W="npx wrangler"
echo "── rank_themes (sursa facțiunilor) ──"
$W d1 execute anime-db --remote --json --command "SELECT slug, substr(title,1,30) AS t, length(tiers) AS tl FROM rank_themes ORDER BY slug" 2>/dev/null | tail -40
echo "── coloane faction pe users ──"
$W d1 execute anime-db --remote --json --command "SELECT name FROM pragma_table_info('users') WHERE name LIKE 'faction%'" 2>/dev/null | tail -15
