#!/usr/bin/env bash
set -uo pipefail
HTML=$(curl -s "https://anime-uke.pages.dev/profile")
echo "faction-box in /profile: $(echo "$HTML" | grep -o 'id="faction-box"' | wc -l)"
echo "tema-grades dropdown (trebuie 0): $(echo "$HTML" | grep -o 'econ-theme-wrap' | wc -l)"
echo "ordine: clasament -> facțiune: $(echo "$HTML" | grep -o 'Clasament săptămânal\|Facțiunea mea' | tr '\n' ' ')"
