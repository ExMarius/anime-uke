#!/usr/bin/env bash
set -uo pipefail
echo "=== Final sitemap fix + test GSC ==="
./deploy.sh
echo "exit deploy: $?"
B="https://anime-uke.pages.dev"
echo "--- single slash xml ---"
curl -s -I "$B/sitemap.xml" | head -5
curl -s "$B/sitemap.xml" | wc -l
echo "--- double slash xml ---"
curl -s -I "$B//sitemap.xml" | head -5
curl -s "$B//sitemap.xml" | wc -l
echo "--- txt ---"
curl -s -I "$B/sitemap.txt" | head -5
curl -s "$B/sitemap.txt" | wc -l
echo "--- sitemap (no ext) ---"
curl -s -I "$B/sitemap" | head -5
curl -s "$B/sitemap" | wc -l
echo "--- robots ---"
curl -s "$B/robots.txt"
