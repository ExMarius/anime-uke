#!/usr/bin/env bash
set -uo pipefail
echo "── testate la Awesome — spre comparație ──"
echo "llms.txt: $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev/llms.txt)"
echo "speculationrules.json: $(curl -sI https://anime-uke.pages.dev/speculationrules.json | head -1 | tr -d '\r')"
curl -sI https://anime-uke.pages.dev/speculationrules.json | grep -i "^location" || echo "(fără Location)"
echo "── cu query-buster ──"
echo "speculationrules.json?cb: $(curl -s -o /dev/null -w '%{http_code}' "https://anime-uke.pages.dev/speculationrules.json?cb=$RANDOM")"
echo "llms.txt?cb: $(curl -s -o /dev/null -w '%{http_code}' "https://anime-uke.pages.dev/llms.txt?cb=$RANDOM")"
