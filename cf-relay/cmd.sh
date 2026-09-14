#!/usr/bin/env bash
set -uo pipefail
./deploy.sh
echo "exit deploy: $?"
D=$(grep -oE "https://[0-9a-f]+\.anime-uke\.pages\.dev" /tmp/depl.txt 2>/dev/null | tail -1)
for U in "https://anime-uke.pages.dev" "$D"; do
  [ -z "$U" ] && continue
  CSS=$(curl -s "$U/assets/css/page-user.css")
  JS=$(curl -s "$U/assets/js/page-profile.js")
  echo "[$U] css taburi: $(echo "$CSS" | grep -o 'ptabs__btn' | wc -l), js taburi: $(echo "$JS" | grep -o 'initProfileTabs' | wc -l)"
done
