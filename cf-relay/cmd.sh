#!/usr/bin/env bash
set -uo pipefail
echo "=== Fix sitemap minimal valid pentru Google ==="
./deploy.sh
echo "exit deploy: $?"
B="https://anime-uke.pages.dev"
echo
echo "sitemap raw:"
curl -s -D - "$B/sitemap.xml" -o /tmp/sitemap.xml | head -20
cat /tmp/sitemap.xml
echo
echo "validate xml:"
python3 -m xml.etree.ElementTree /tmp/sitemap.xml && echo "XML valid" || echo "XML invalid"
