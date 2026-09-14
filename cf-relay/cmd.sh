#!/usr/bin/env bash
set -uo pipefail
echo "── deploy final facțiuni ──"
./deploy.sh
echo "exit deploy: $?"
echo "── profil servit: ordinea secțiunilor ──"
D=$(curl -s "https://anime-uke.pages.dev/" -o /dev/null -w "%{redirect_url}")
HTML=$(curl -s "https://anime-uke.pages.dev/profil")
echo "faction-box in HTML: $(echo "$HTML" | grep -o 'id="faction-box"' | wc -l)"
echo "clasament inainte de facțiune: $(echo "$HTML" | awk '/Clasament saptamanal|Clasament săptămânal/{c=1} /faction-box/{if(c)print "DA"; exit}')"
echo "── API ──"
curl -s -o /dev/null -w "factions anon: %{http_code}\n" "https://anime-uke.pages.dev/api/factions"
