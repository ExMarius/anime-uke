#!/usr/bin/env bash
set -uo pipefail
./deploy.sh
echo "exit deploy: $?"

B="https://anime-uke.pages.dev"
echo
echo "── verificare post-deploy ──"
# Rutele care lipseau din router: inainte 404, acum trebuie 401 (cer login).
for R in /api/factions /api/shop/activate; do
  M=GET; [ "$R" = "/api/shop/activate" ] && M=POST
  echo "  $M $R -> $(curl -s -o /dev/null -w '%{http_code}' -X $M -H "Origin: $B" "$B$R")   (asteptat 401, nu 404)"
done
# Admin episoade: fara login → 401 (inainte de fix, cu login, dadea 500).
echo "  GET /api/admin/episodes?series_id=1019 -> $(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/episodes?series_id=1019")   (asteptat 401)"
# Codul nou a ajuns pe edge?
JS=$(curl -s "$B/assets/js/page-profile.js")
echo "  profile.js contine renderEconomy() in initEconomy: $(echo "$JS" | grep -c 'apelul se pierduse')"
echo "  episode.html iframe allowfullscreen: $(curl -s "$B/episode" | grep -c 'webkitallowfullscreen')"
