#!/usr/bin/env bash
set -uo pipefail
echo "── deploy facțiuni ──"
./deploy.sh
echo "exit deploy: $?"
echo "── migrarea 0022 ──"
grep -A2 "Schema D1" /tmp/nofill 2>/dev/null || true
echo "── API facțiuni (401 anonim = OK) ──"
curl -s -o /dev/null -w "factions: %{http_code}\n" "https://anime-uke.pages.dev/api/factions"
echo "── codul servit ──"
JS=$(curl -s "https://anime-uke.pages.dev/assets/js/page-profile.js?cb=$RANDOM")
echo "panou facțiune: $(echo "$JS" | grep -o "faction__grid" | wc -l)"
echo "alegere blocată: $(echo "$JS" | grep -o "începutul lunii următoare" | wc -l)"
CSS=$(curl -s "https://anime-uke.pages.dev/assets/css/style.css?cb=$RANDOM")
echo "CSS facțiune: $(echo "$CSS" | grep -o "faction__card" | wc -l)"
echo "── tema de grades auto (workers) ──"
