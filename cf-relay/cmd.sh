#!/usr/bin/env bash
set -uo pipefail
echo "── deploy economie clara ──"
./deploy.sh
echo "exit deploy: $?"
echo "── server: cufere în gold ──"
curl -s "https://anime-uke.pages.dev/api/chests?series_id=1014" -o /dev/null -w "chests (401 anonim OK): %{http_code}\n"
echo "── client episod: paintProgress silentios ──"
JS=$(curl -s "https://anime-uke.pages.dev/assets/js/page-episode.js?cb=$RANDOM")
echo "justWatched: $(echo "$JS" | grep -o "justWatched" | wc -l)"
echo "toast VIZIONAT: $(echo "$JS" | grep -o "VIZIONAT" | wc -l)"
echo "── client serie: gold în cufere ──"
JS2=$(curl -s "https://anime-uke.pages.dev/assets/js/page-series.js?cb=$RANDOM")
echo "🪙 gold în chestCard: $(echo "$JS2" | grep -o "primite" | wc -l)"
echo "── legende ──"
curl -s "https://anime-uke.pages.dev/profile?cb=$RANDOM" | grep -o "econ__legend" | head -1
curl -s "https://anime-uke.pages.dev/shop?cb=$RANDOM" | grep -o "Puncte ≠ Gold" | head -1
echo "── pagini ──"
for u in / /serie/1014 /shop; do echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev$u)"; done
