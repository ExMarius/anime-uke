#!/usr/bin/env bash
set -uo pipefail
echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"
echo "sanitate: / -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev/)"
#── verificare sitemap imbunatatit ──
echo "── /sitemap.xml ──"
curl -s https://anime-uke.pages.dev/sitemap.xml
