#!/usr/bin/env bash
# Deploy + verificare: cereri de cod invitație + cache assets (productie).
set -uo pipefail
B="https://anime-uke.pages.dev"
H="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
DB="7209b0bd-227b-46d0-b376-6157b56734fa"
API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${DB}/query"
q() { curl -sS -X POST "$API" -H "$H" -H "Content-Type: application/json" -d "{\"sql\": \"$1\"}"; }

echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"

echo ""
echo "═══ MIGRATIA 0018 (invite_requests) ═══"
q "SELECT COUNT(*) AS exista FROM sqlite_master WHERE type='table' AND name='invite_requests'" | jq -c '.result[0].results[0]'

echo ""
echo "═══ FLUX PUBLIC: cerere de cod (cont de proba, se sterge) ═══"
R=$(curl -s -X POST "$B/api/invite-requests" -H "Content-Type: application/json" -H "Origin: $B" \
  -d '{"email":"probe.audit@exemplu.ro","message":"Verificare automata a fluxului de cereri (se sterge)."}')
echo "POST: $(echo "$R" | head -c 120)"
TICKET=$(echo "$R" | jq -r '.request_code // empty')
if [ -n "$TICKET" ]; then
  echo "GET bilet: $(curl -s "$B/api/invite-requests?code=$TICKET" -H "Origin: $B" | jq -c '.')"
fi
echo "admin fara sesiune -> astept 401: $(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/invite-requests" -H "Origin: $B")"
echo "portalul exista pe /login: $(curl -s "$B/login" | grep -c 'cere-cod') aparitii"

echo ""
echo "═══ CURATENIE: stergem cererea de proba ═══"
[ -n "$TICKET" ] && q "DELETE FROM invite_requests WHERE request_code = '$TICKET'" | jq -c '{success, errors: [.errors[]?.message]}'
q "SELECT COUNT(*) AS ramase FROM invite_requests" | jq -c '.result[0].results[0]'

echo ""
echo "═══ CACHE ASSETS ═══"
echo "style.css?v=abc: $(curl -s -o /dev/null -w '%{http_code} → %header{cache-control}' "$B/assets/css/style.css?v=abc")"
echo "covers/one-piece.jpg: $(curl -s -o /dev/null -w '%{http_code} → %header{cache-control}' "$B/covers/one-piece.jpg")"
echo "meta og:image pe /: $(curl -s "$B/login" -o /dev/null -w '%{http_code}') (login 200), og:image: $(curl -s "$B/" -L | grep -c 'og:image' || true)"

echo ""
echo "── still alive ──"
for p in / /login /register; do echo "  $p -> $(curl -s -o /dev/null -w '%{http_code}' "$B$p")"; done
