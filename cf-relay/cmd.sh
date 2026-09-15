#!/usr/bin/env bash
set -uo pipefail
echo "=== Fix sitemap: scoate CORP/CSP ca sa-l citeasca Google ==="
./deploy.sh
echo "exit deploy: $?"
B="https://anime-uke.pages.dev"
echo
echo "sitemap raw:"
curl -s -D - "$B/sitemap.xml" -o /tmp/sitemap.xml | head -20
cat /tmp/sitemap.xml | head -30
echo
echo "count serie:"
grep -c "/serie/" /tmp/sitemap.xml || echo 0
echo "count episod:"
grep -c "/episod/" /tmp/sitemap.xml || echo 0
echo
echo "check headers - should NOT have Cross-Origin-Resource-Policy: same-origin"
curl -s -I "$B/sitemap.xml" | grep -i -E "content-type|corp|cross-origin"
