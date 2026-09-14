#!/usr/bin/env bash
set -uo pipefail
echo "── paginile din sitemap răspund? ──"
for u in / /series /serie/1014; do
  echo "/$u -> $(curl -s -o /dev/null -w '%{http_code} %{content_type}' https://anime-uke.pages.dev$u)"
done
echo "── sitemap acum ──"
curl -s "https://anime-uke.pages.dev/sitemap.xml?cb=$RANDOM" | head -8
