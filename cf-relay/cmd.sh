#!/usr/bin/env bash
# DEPLOY + SWEEP COMPLET IN PRODUCTIE (pagini, API cu login real, assets).
set -uo pipefail
echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"

echo ""
echo "═══ SWEEP PRODUCTIE ═══"
B="https://anime-uke.pages.dev"
check() { local c; c=$(curl -s -o /dev/null -w '%{http_code}' "$2" ${3:+-H "Cookie: $3"} ${4:+-H "Origin: $B"}); printf '  %-38s %s\n' "$1" "$c"; }

echo "── pagini (guest) ──"
check "/" "$B/"
check "/login" "$B/login"
check "/register" "$B/register"
check "/series (302)" "$B/series"
check "/admin (302)" "$B/admin"

echo "── pagini (logat) ──"
C=$(curl -s -i -X POST "$B/api/auth/login" -H "Content-Type: application/json" -H "Origin: $B" \
  -d "{\"username\":\"${PROBE_USER:-}\",\"password\":\"${PROBE_PASS:-}\"}" | grep -i '^set-cookie' | cut -d' ' -f2 | cut -d';' -f1)
if [ -n "$C" ]; then
  echo "  (login probe OK)"
  for p in / /series /profile /shop /admin; do check "$p" "$B$p" "$C"; done
  echo "── API-uri (logat) ──"
  for a in /api/series /api/top /api/continue /api/pulse /api/missions /api/economy /api/leaderboard /api/shop /api/ranks /api/notifications/unread; do check "$a" "$B$a" "$C" "$B"; done
else
  echo "  (nu am PROBE_USER/PROBE_PASS — sar peste sectiunea logata)"
fi

echo "── assets ──"
for a in /assets/css/style.css /assets/js/core.js /assets/js/page-episode.js /robots.txt /sitemap.xml; do check "$a" "$B$a"; done
