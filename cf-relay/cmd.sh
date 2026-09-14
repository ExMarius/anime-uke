#!/usr/bin/env bash
set -uo pipefail
echo "── 1. GET standard /sitemap.xml ──"
curl -s -o /dev/null -w "status=%{http_code} tip=%{content_type} marime=%{size_download}B\n" https://anime-uke.pages.dev/sitemap.xml

echo "── 2. GET ca Googlebot (UA falsificat) HTTP/1.1 ──"
curl -s --http1.1 -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" \
  -o /tmp/sm-gb.xml -w "status=%{http_code} tip=%{content_type} marime=%{size_download}B codare=%{content_type}\n" \
  https://anime-uke.pages.dev/sitemap.xml
head -c 200 /tmp/sm-gb.xml; echo

echo "── 3. GET cu gzip fortat ──"
curl -s -H "Accept-Encoding: gzip" -o /tmp/sm-gz -w "status=%{http_code} codare=%{header_json}" \
  https://anime-uke.pages.dev/sitemap.xml 2>/dev/null | head -c 300; echo
file /tmp/sm-gz

echo "── 4. XML parsa cu OK corecta (ca browserul) ──"
curl -s https://anime-uke.pages.dev/sitemap.xml | python3 -c "
import sys, xml.etree.ElementTree as ET
ET.fromstring(sys.stdin.buffer.read())
print('PARSE OK — XML ireprosabil')"

echo "── 5. BOM sau caractere invizibile la inceput? ──"
curl -s https://anime-uke.pages.dev/sitemap.xml | head -c 16 | xxd | head -1

echo "── 6. robots.txt ca Googlebot ──"
curl -s -A "Googlebot" -o /dev/null -w "status=%{http_code}\n" https://anime-uke.pages.dev/robots.txt
