#!/usr/bin/env bash
# Re-verificare finala (runner-ul are internet stabil).
set -uo pipefail
B="https://anime-uke.pages.dev"
echo "genuri:      $(curl -s "$B/api/genres" -H "Origin: $B" | head -c 200)"
echo "recent:      $(curl -s "$B/api/recent" -H "Origin: $B" | head -c 200)"
echo "filtru gen:  $(curl -s "$B/api/series?gen=Ac%C8%9Biune" -H "Origin: $B" | head -c 120)"
echo "genre-select pe /:  $(curl -s "$B/" | grep -cE 'genre-select')"
echo "recent-section pe /: $(curl -s "$B/" | grep -cE 'recent-section')"
echo "pill-ro in page-index.js: $(curl -s "$B/assets/js/page-index.js?v=x" | grep -cE 'pill-ro')"
echo "footer pe /: $(curl -s "$B/" | grep -cE 'site-foot')"
echo "sanitate: / -> $(curl -s -o /dev/null -w '%{http_code}' "$B/")"
