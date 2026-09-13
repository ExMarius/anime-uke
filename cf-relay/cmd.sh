#!/usr/bin/env bash
# Deploy + verificare: invitațiile ȘTERSE, înregistrarea publică.
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
echo "═══ TABELLELE DE INVITAȚII ȘTERSE DIN D1 ═══"
q "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('invite_codes','invite_requests')" | jq -c '.result[0].results'
echo "(array gol = ambele plecate)"

echo ""
echo "═══ RUTELE VECHI → 404, ÎNREGISTRAREA → DESCHISĂ ═══"
for r in "/api/admin/invites" "/api/invite-requests" "/api/admin/invite-requests"; do
  echo "  $r -> $(curl -s -o /dev/null -w '%{http_code}' -X POST "$B$r" -H "Origin: $B" -H "Content-Type: application/json" -d '{}')"
done
echo "register-options: $(curl -s "$B/api/auth/register-options" -H "Origin: $B" | jq -c '.')"

USR="fara_cod_$(date +%s)"
REG=$(curl -s -X POST "$B/api/auth/register" -H "Content-Type: application/json" -H "Origin: $B" \
  -d "{\"username\":\"${USR}\",\"email\":\"${USR}@probe.local\",\"password\":\"ParolaProbe123\"}")
echo "cont nou FĂRĂ cod: $(echo "$REG" | head -c 100)"

echo ""
echo "═══ CURATENIE + STARE FINALA ═══"
PID=$(q "SELECT id FROM users WHERE username = '${USR}'" | jq -r '.result[0].results[0].id // empty')
[ -n "$PID" ] && q "DELETE FROM users WHERE id = ${PID}" | jq -c '{success}'
q "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM anime_series) AS serii" | jq -c '.result[0].results[0]'
echo "login -> $(curl -s -o /dev/null -w '%{http_code}' "$B/login") · register -> $(curl -s -o /dev/null -w '%{http_code}' "$B/register")"
