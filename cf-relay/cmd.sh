#!/usr/bin/env bash
set -uo pipefail
echo "── deploy admin UX ──"
./deploy.sh
echo "exit deploy: $?"
echo "── next_number în API (login admin de probă interzis; verific doar codul servit) ──"
JS=$(curl -s "https://anime-uke.pages.dev/assets/js/page-admin-serie.js?cb=$RANDOM")
echo "prefill nextEpNumber: $(echo "$JS" | grep -o "nextEpNumber" | head -1)"
echo "flux rapid (focus sursa): $(echo "$JS" | grep -o "src-row input" | head -1)"
JS2=$(curl -s "https://anime-uke.pages.dev/assets/js/page-admin-serii.js?cb=$RANDOM")
echo "duplicat-hint: $(echo "$JS2" | grep -o "dup-hint" | head -1)"
echo "rând clickabil: $(echo "$JS2" | grep -o "row-click" | head -1)"
CSS=$(curl -s "https://anime-uke.pages.dev/assets/css/style.css?cb=$RANDOM")
echo "CSS .dup-hint: $(echo "$CSS" | grep -o ".dup-hint{" | head -1)"
JS3=$(curl -s "https://anime-uke.pages.dev/assets/js/page-admin.js?cb=$RANDOM")
echo "NaN fix (limit separat): $(echo "$JS3" | grep -o "toLocaleString" | wc -l)"
echo "── pagina admin/serii ──"
curl -s "https://anime-uke.pages.dev/admin/serii?cb=$RANDOM" | grep -o 'id="dup-hint"' | head -1
