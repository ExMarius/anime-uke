#!/usr/bin/env bash
# Deploy + verificarea lansării publice (fără conturi de probă — totul e anonim).
set -uo pipefail
B="https://anime-uke.pages.dev"

echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"

echo ""
echo "═══ PUBLIC (fără cont) ═══"
for p in / /series "/episode?id=1"; do
  echo "  GET $p -> $(curl -s -o /dev/null -w '%{http_code}' "$B$p")"
done
echo "  /api/series      -> $(curl -s -o /dev/null -w '%{http_code}' "$B/api/series")"
echo "  /api/top         -> $(curl -s -o /dev/null -w '%{http_code}' "$B/api/top")"
echo "  /api/pulse       -> $(curl -s -o /dev/null -w '%{http_code}' "$B/api/pulse")"
echo "  /api/comments    -> $(curl -s -o /dev/null -w '%{http_code}' "$B/api/comments?episode_id=1")"

echo ""
echo "═══ PROTEJAT (fără cont) ═══"
for p in /profile /shop /admin; do
  echo "  GET $p -> $(curl -s -o /dev/null -w '%{http_code}' "$B$p") (302 asteptat)"
done
echo "  POST /api/progress -> $(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/progress" -H "Origin: $B" -H "Content-Type: application/json" -d '{"episode_id":1,"seconds":30}') (401 asteptat)"
echo "  POST /api/comments -> $(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/comments" -H "Origin: $B" -H "Content-Type: application/json" -d '{"episode_id":1,"body":"test anonim"}') (401 asteptat)"

echo ""
echo "═══ SEO ═══"
echo "robots.txt Allow: $(curl -s "$B/robots.txt" | grep -c '^Allow')"
echo "sitemap conține serii: $(curl -s "$B/sitemap.xml" | grep -c 'series?id=')"
echo "nudge pe /episode: $(curl -s "$B/episode?id=1" | grep -c 'page-episode') (1 = pagina publică servește)"

echo ""
echo "── sanitate ──"
echo "/login -> $(curl -s -o /dev/null -w '%{http_code}' "$B/login") · /register -> $(curl -s -o /dev/null -w '%{http_code}' "$B/register")"
