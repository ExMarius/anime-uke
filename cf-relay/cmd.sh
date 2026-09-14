#!/usr/bin/env bash
set -uo pipefail
echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"
echo "sanitate: / -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev/)"
#── deploy GSC meta tag (verificare Google Search Console) ──
echo "marcaj: GSC meta v1"
