#!/usr/bin/env bash
set -uo pipefail
echo "── REDEPLOY cod corect (public + GSC) ──"
./deploy.sh
echo "exit deploy: $?"
echo "── verificare completă ──"
echo "sanitate /: $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev/)"
echo "sanitate /series: $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev/series)"
for p in "" series episode login register; do
  m=$(curl -s "https://anime-uke.pages.dev/$p" | grep -c 'google-site-verification')
  echo "meta GSC pe /$p: $m"
done
echo "── sitemap ──"
curl -s "https://anime-uke.pages.dev/sitemap.xml?cb=$RANDOM" | head -6
