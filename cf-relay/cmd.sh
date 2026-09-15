#!/usr/bin/env bash
set -uo pipefail
echo "=== SEO boost: sitemap episoade + titluri episod ro sub + homepage keywords ==="
./deploy.sh
echo "exit deploy: $?"
B="https://anime-uke.pages.dev"
echo
echo "homepage checks:"
curl -s "$B/" | grep -c "aads-wrap"
curl -s "$B/" | grep -c "2455410"
curl -s "$B/" | grep -o "<title>.*</title>"
echo
echo "sitemap checks:"
curl -s "$B/sitemap.xml" | head -20
curl -s "$B/sitemap.xml" | grep -c "/serie/"
curl -s "$B/sitemap.xml" | grep -c "/episod/"
