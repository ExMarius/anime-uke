#!/usr/bin/env bash
set -uo pipefail
echo "── deploy top saptamanal premiat ──"
./deploy.sh
echo "exit deploy: $?"
echo "── migrarea 0021 ──"
grep -E "Schema|migrari" /tmp/nofill 2>/dev/null || true
echo "── clasamentul (401 anonim = OK; codul servit e testat mai jos) ──"
curl -s -o /dev/null -w "leaderboard: %{http_code}\n" "https://anime-uke.pages.dev/api/leaderboard"
JS=$(curl -s "https://anime-uke.pages.dev/assets/js/page-profile.js?cb=$RANDOM")
echo "lb-prize în UI: $(echo "$JS" | grep -o "lb-prize" | wc -l)"
echo "premii în UI: $(echo "$JS" | grep -o "500 🥈 300 🥉 200" | wc -l)"
echo "alltime secundar: $(echo "$JS" | grep -o "lb-alltime" | wc -l)"
echo "── migrarile aplicate (din deploy output) ──"
