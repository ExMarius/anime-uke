#!/usr/bin/env bash
set -uo pipefail
echo "=== Fix sitemap GSC: minimal + txt + CORS ==="
./deploy.sh
echo "exit deploy: $?"
B="https://anime-uke.pages.dev"
echo
curl -s -I "$B/sitemap.xml" | head -20
curl -s "$B/sitemap.xml" | head -20
echo "--- txt ---"
curl -s "$B/sitemap.txt" | head -20
echo "--- robots ---"
curl -s "$B/robots.txt"
