#!/usr/bin/env bash
set -uo pipefail
echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"
echo "sanitate: / -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev/)"
#── diagnostic sitemap (GSC „Nu s-a putut prelua") ──
echo "── HEADERS /sitemap.xml ──"
curl -sI https://anime-uke.pages.dev/sitemap.xml | head -12
echo "── BODY /sitemap.xml (primele 25 linii) ──"
curl -s https://anime-uke.pages.dev/sitemap.xml | head -25
echo "── robots.txt ──"
curl -s https://anime-uke.pages.dev/robots.txt
echo "── validare XML ──"
curl -s https://anime-uke.pages.dev/sitemap.xml -o /tmp/sm.xml && python3 -c "
import xml.etree.ElementTree as ET
t = ET.parse('/tmp/sm.xml')
ns = '{http://www.sitemaps.org/schemas/sitemap/0.9}'
urls = t.getroot().findall(ns+'url')
print('XML VALID,', len(urls), 'URL-uri in sitemap')
for u in urls[:6]:
    loc = u.find(ns+'loc')
    print('  -', loc.text if loc is not None else '?')
"
