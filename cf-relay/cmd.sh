#!/usr/bin/env bash
# Deploy final + verificarea completa a lansarii publice.
set -uo pipefail
B="https://anime-uke.pages.dev"
echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"
echo ""
echo "═══ VERDICT FINAL (fără cont) ═══"
for p in / /series "/episode?id=1"; do echo "  GET $p -> $(curl -s -o /dev/null -w '%{http_code}' "$B$p")"; done
for a in "/api/series" "/api/top" "/api/pulse" "/api/comments?episode_id=1"; do echo "  GET $a -> $(curl -s -o /dev/null -w '%{http_code}' "$B$a")"; done
echo "  pulse data: $(curl -s "$B/api/pulse" -H "Origin: $B" | head -c 100)"
echo "── protejat ──"
for p in /profile /shop /admin; do echo "  GET $p -> $(curl -s -o /dev/null -w '%{http_code}' "$B$p")"; done
echo "  POST /api/progress -> $(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/progress" -H "Origin: $B" -H "Content-Type: application/json" -d '{"episode_id":1,"seconds":30}')"
echo "  POST /api/comments -> $(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/comments" -H "Origin: $B" -H "Content-Type: application/json" -d '{"episode_id":1,"body":"test"}')"
echo "── sanitate ──"
echo "/login -> $(curl -s -o /dev/null -w '%{http_code}' "$B/login") · /register -> $(curl -s -o /dev/null -w '%{http_code}' "$B/register")"
