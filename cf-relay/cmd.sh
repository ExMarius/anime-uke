#!/usr/bin/env bash
set -uo pipefail
echo "=== Sitemap static + no-store pentru GSC ==="
./deploy.sh
echo "exit deploy: $?"
B="https://anime-uke.pages.dev"
echo "--- xml headers ---"
curl -s -I "$B/sitemap.xml" | grep -i -E "content-type|cache|access|cf-ray"
echo "--- xml body ---"
curl -s "$B/sitemap.xml"
echo "--- txt ---"
curl -s "$B/sitemap.txt"
echo "--- robots ---"
curl -s "$B/robots.txt"
