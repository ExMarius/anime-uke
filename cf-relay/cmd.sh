#!/usr/bin/env bash
# Deploy + verificare finala cache (productie).
set -uo pipefail
B="https://anime-uke.pages.dev"
echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"
echo ""
echo "═══ CACHE FINAL ═══"
echo "style.css CU ?v=   → $(curl -s -o /dev/null -w '%header{cache-control}' "$B/assets/css/style.css?v=probe")"
echo "core.js FARA ?v=   → $(curl -s -o /dev/null -w '%header{cache-control}' "$B/assets/js/core.js")"
echo "covers/1.jpg       → $(curl -s -o /dev/null -w '%header{cache-control}' "$B/covers/one-piece.jpg")"
echo "hero-1.jpg         → $(curl -s -o /dev/null -w '%header{cache-control}' "$B/assets/img/hero-1.jpg")"
echo ""
echo "── still alive ──"
for p in / /login; do echo "  $p -> $(curl -s -o /dev/null -w '%{http_code}' "$B$p")"; done
