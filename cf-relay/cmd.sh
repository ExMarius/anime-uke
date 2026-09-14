#!/usr/bin/env bash
set -uo pipefail
for D in "https://anime-uke.pages.dev" "https://9d5196e7.anime-uke.pages.dev"; do
  HTML=$(curl -s "$D/profile")
  echo "[$D] faction-box: $(echo "$HTML" | grep -o 'faction-box' | wc -l), tema-dropdown: $(echo "$HTML" | grep -o 'econ-theme-wrap' | wc -l)"
done
