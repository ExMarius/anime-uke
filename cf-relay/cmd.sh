#!/usr/bin/env bash
# Deploy + verificare optimizari catalog (toate probele sunt anonime/publice).
set -uo pipefail
B="https://anime-uke.pages.dev"
echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"
echo ""
echo "═══ NOU (public) ═══"
echo "genuri:      $(curl -s "$B/api/genres" -H "Origin: $B" | head -c 160)"
echo "recent:      $(curl -s "$B/api/recent" -H "Origin: $B" | head -c 160)"
echo "filtru gen:  $(curl -s -o /dev/null -w '%{http_code}' "$B/api/series?gen=Ac%C8%9Biune" -H "Origin: $B")"
echo "filtru stat: $(curl -s -o /dev/null -w '%{http_code}' "$B/api/series?status=completed" -H "Origin: $B")"
echo "RO SUB pe /: $(curl -s "$B/" | grep -c 'pill-ro\|genre-select' ) aparitii (>=2 asteptat)"
echo "footer pe /: $(curl -s "$B/" | grep -c 'site-foot') aparitii"
echo "JSON-LD pe serie: $(curl -s "$B/series?id=1" | grep -c 'ld-series') (0 = se injecteaza din JS, normal)"
echo ""
echo "── sanitate ──"
echo "/ -> $(curl -s -o /dev/null -w '%{http_code}' "$B/") · /login -> $(curl -s -o /dev/null -w '%{http_code}' "$B/login")"
