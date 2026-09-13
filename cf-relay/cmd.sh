#!/usr/bin/env bash
# Diagnoza: ce URL-uri media expune pagina tenor si care functioneaza.
set -uo pipefail
PAGE=$(curl -sL "https://tenor.com/paKwmvU0Mgf.gif")
echo "── toate URL-urile media1/c.tenor din pagina ──"
echo "$PAGE" | grep -oE 'https://(media[0-9]?|c)\.tenor\.com/[^" \\]+\.(gif|webp|mp4|png|jpg)' | sort -u | head -20 > /tmp/urls.txt
cat /tmp/urls.txt
echo "── care raspund cu imagine? ──"
while read -r u; do
  CT=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' -I "$u")
  echo "$CT  <-  $u"
done < /tmp/urls.txt
echo "── contentUrl din JSON-LD ──"
echo "$PAGE" | grep -oE '"contentUrl":"[^"]+"' | head -5
