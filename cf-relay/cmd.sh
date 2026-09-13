#!/usr/bin/env bash
# DEPLOY: rezolvator avatar Tenor + fix rang duplicat.
set -uo pipefail
echo "── deploy ──"
./deploy.sh
echo "exit: $?"
echo "── dovada: linkul tenor al utilizatorului, rezolvat ca pe prod ──"
PAGE=$(curl -sL "https://tenor.com/paKwmvU0Mgf.gif" | head -c 400000)
OG=$(echo "$PAGE" | grep -oE '<meta[^>]+property="og:image[^>]*' | head -1 | grep -oE 'content="[^"]+"' | head -1)
echo "og:image: ${OG:-NEGASIT}"
DIRECT=$(echo "$OG" | sed 's/content="//; s/"$//')
if [ -n "$DIRECT" ]; then
  curl -sI "$DIRECT" | grep -iE "^HTTP|content-type" | head -3
fi
