#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
W="$PWD/node_modules/.bin/wrangler"; [ -x "$W" ] || W="npx wrangler"
for q in "SELECT COUNT(*) AS n FROM users" "SELECT COUNT(*) AS n FROM series" "SELECT COUNT(*) AS n FROM episodes" "SELECT COUNT(*) AS n FROM rank_themes" "SELECT COUNT(*) AS n FROM faction_rep" "SELECT COUNT(*) AS n FROM faction_winners" "SELECT COUNT(*) AS n FROM lb_prizes" "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'"; do
  R=$($W d1 execute anime-db --remote --json --command "$q" 2>&1 | grep -o '"n": [0-9]*' | head -1)
  echo "$(echo $q | sed "s/SELECT COUNT(\*) AS n FROM //;s/ .*//") = ${R#\": }"
done
