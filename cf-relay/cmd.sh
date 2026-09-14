#!/usr/bin/env bash
set -uo pipefail
for D in "https://anime-uke.pages.dev" "https://9d5196e7.anime-uke.pages.dev"; do
  echo "[$D] profile.html: code=$(curl -s -o /tmp/x.html -w "%{http_code}" "$D/profile.html") faction-box=$(grep -o 'faction-box' /tmp/x.html | wc -l) temadrop=$(grep -o 'econ-theme-wrap' /tmp/x.html | wc -l)"
done
