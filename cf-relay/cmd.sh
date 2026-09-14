#!/usr/bin/env bash
set -uo pipefail
JS=$(curl -s "https://anime-uke.pages.dev/assets/js/page-episode.js?cb=$RANDOM")
echo "bundle marcat-ca: $(echo "$JS" | grep -o "marcat ca" | wc -l)"
echo "bundle paintProgress body: $(echo "$JS" | grep -o "Episod marcat" | wc -l)"
echo "bundle fara cronometru vazibil: $(echo "$JS" | grep -o "Se acumulează timp" | wc -l)"
JS2=$(curl -s "https://anime-uke.pages.dev/assets/js/page-series.js?cb=$RANDOM")
echo "serie vizionate-aici: $(echo "$JS2" | grep -o "vizionate aici" | wc -l)"
echo "serie gold primite: $(echo "$JS2" | grep -o "primite" | wc -l)"
