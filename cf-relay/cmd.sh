#!/usr/bin/env bash
set -uo pipefail
echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"
echo "sanitate: / -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev/)"
#── deploy GSC meta tag (verificare Google Search Console) ──
echo "marcaj: GSC meta v1"
for p in "" series episode login register; do
  u="https://anime-uke.pages.dev/$p"
  m=$(curl -s "$u" | grep -o 'google-site-verification' | head -1)
  echo "meta GSC pe /$p: ${m:-LIPSA}"
done
