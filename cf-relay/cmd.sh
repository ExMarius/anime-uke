#!/usr/bin/env bash
# Simuleaza EXACT fluxul resolverului pe linkul utilizatorului.
set -uo pipefail
URL="https://tenor.com/paKwmvU0Mgf.gif"
HTML=$(curl -sL "$URL" | head -c 400000)
OG=$(echo "$HTML" | grep -oE '<meta[^>]+property="og:image[^>]*' | head -1 | grep -oE 'content="[^"]+"' | sed 's/content="//; s/"$//' | head -1)
echo "1) og:image gasit:    $OG"
DIRECT=$(echo "$OG" | sed -E 's#(https://)media[0-9]?\.tenor\.com/m/([^/]+)/([^/?#]+)#\1media.tenor.com/\2/\3#')
echo "2) varianta vida:     $DIRECT"
CT=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' -I "$DIRECT")
echo "3) verificare HEAD:   $CT"
if echo "$CT" | grep -q "^200 image/"; then echo "REZULTAT: ✓ avatarul va functiona cu acest URL"; else echo "REZULTAT: ✗ inca mort"; fi
