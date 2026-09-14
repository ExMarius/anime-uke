#!/usr/bin/env bash
set -uo pipefail
echo "── probă reală: login + catalog shop ──"
J=/tmp/probe-cookies.txt
rm -f $J
LOGIN=$(curl -s -c $J -X POST https://anime-uke.pages.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -H "Origin: https://anime-uke.pages.dev" \
  -d "{\"username\":\"$PROBE_USER\",\"password\":\"$PROBE_PASS\"}")
echo "login: $(echo "$LOGIN" | head -c 80)"
curl -s -b $J https://anime-uke.pages.dev/api/shop | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('gold:', d.get('gold'))
print('culori în catalog:', len(d.get('colors',[])), '| teme:', len(d.get('themes',[])))
print('primele 3 culori:', [(c['id'],c['price']) for c in d.get('colors',[])[:3]])
print('teme:', [(t['id'],t['price']) for t in d.get('themes',[])])
"
echo "── activez culoarea verde (probe) apoi revin ──"
curl -s -b $J -X POST https://anime-uke.pages.dev/api/shop/activate -H "Content-Type: application/json" -H "Origin: https://anime-uke.pages.dev" -d '{"type":"color","id":"color_green"}' | head -c 120; echo
curl -s -b $J -X POST https://anime-uke.pages.dev/api/shop/activate -H "Content-Type: application/json" -H "Origin: https://anime-uke.pages.dev" -d '{"type":"color","id":""}' | head -c 120; echo
rm -f $J
