#!/usr/bin/env bash
# Deploy + verificare plafoane in productie.
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
echo "═══ PLAFOANE IN PRODUCTIE ═══"
echo "register-options:"
curl -s "$B/api/auth/register-options" -H "Origin: $B" | jq -c '.'
echo "contez direct in D1:"
q "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM anime_series) AS series, (SELECT COUNT(*) FROM chat_messages) AS chat" | jq -c '.result[0].results[0]'
echo "chat depaseste plafonul de 500?"
q "SELECT COUNT(*) AS peste_plafon FROM (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 1 OFFSET 500)" | jq -c '.result[0].results[0]'
echo "── still alive ──"
for p in / /login; do echo "  $p -> $(curl -s -o /dev/null -w '%{http_code}' "$B$p")"; done
