#!/usr/bin/env bash
set -uo pipefail
curl -s -D /tmp/h.txt "https://anime-uke.pages.dev/profile" -o /tmp/p.txt
head -1 /tmp/h.txt
grep -i "location\|content-type" /tmp/h.txt
echo "size: $(wc -c < /tmp/p.txt)"
head -c 300 /tmp/p.txt
echo
echo "--- cu cookie anonim / follow ---"
curl -sL -o /tmp/p2.txt -w "final: %{url_effective} code=%{http_code}\n" "https://anime-uke.pages.dev/profile"
grep -o "<title>[^<]*" /tmp/p2.txt | head -1
