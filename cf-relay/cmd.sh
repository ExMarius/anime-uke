#!/usr/bin/env bash
set -uo pipefail
D=$(grep -oE "https://[0-9a-f]+\.anime-uke\.pages\.dev" /tmp/pages.txt | tail -1)
echo "deployment: $D"
echo "modulepreload pe deployment: $(curl -s "$D/" | grep -c modulepreload)"
echo "weserv în core.js pe deployment: $(curl -s "$D/assets/js/core.js" | grep -c weserv)"
echo "── și pe alias, cu cache-buster ──"
echo "modulepreload alias: $(curl -s "https://anime-uke.pages.dev/?cb=$RANDOM" | grep -c modulepreload)"
