#!/usr/bin/env bash
set -uo pipefail
echo "── deploy fix secret gold ──"
./deploy.sh
echo "exit deploy: $?"
echo "── chest GET (anonim=401, doar verificam ca workerul e nou) ──"
curl -s -o /dev/null -w "chests: %{http_code}\n" "https://anime-uke.pages.dev/api/chests?series_id=1014"
