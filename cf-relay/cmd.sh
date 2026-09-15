#!/usr/bin/env bash
set -uo pipefail
echo "=== Fix double slash //sitemap.xml pentru GSC ==="
./deploy.sh
echo "exit deploy: $?"
B="https://anime-uke.pages.dev"
echo "test single slash:"
curl -s -I "$B/sitemap.xml" | head -5
echo "test double slash (GSC bug):"
curl -s -I "$B//sitemap.xml" | head -5
curl -s "$B//sitemap.xml" | head -5
