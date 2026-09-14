#!/usr/bin/env bash
set -uo pipefail
echo "── stare finală alias public ──"
for p in "" series episode login register; do
  m=$(curl -s "https://anime-uke.pages.dev/$p" | grep -c 'google-site-verification')
  echo "meta GSC pe /$p: $m"
done
echo "sitemap pe alias:"
curl -s "https://anime-uke.pages.dev/sitemap.xml" | grep -c "serie/1014"
echo "/ -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev/)"
