#!/usr/bin/env bash
# Deploy + verificare înregistrare deschisă (cont de probă, se șterge).
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
echo "═══ ÎNREGISTRARE DESCHISĂ (proba) ═══"
echo "register-options: $(curl -s "$B/api/auth/register-options" -H "Origin: $B" | jq -c '.')"
USR="deschis_$(date +%s)"
REG=$(curl -s -X POST "$B/api/auth/register" -H "Content-Type: application/json" -H "Origin: $B" \
  -d "{\"username\":\"${USR}\",\"email\":\"${USR}@probe.local\",\"password\":\"ParolaProbe123\"}")
echo "register FĂRĂ cod: $(echo "$REG" | head -c 120)"
LOG=$(curl -s -i -X POST "$B/api/auth/login" -H "Content-Type: application/json" -H "Origin: $B" \
  -d "{\"username\":\"${USR}\",\"password\":\"ParolaProbe123\"}" | grep -i '^set-cookie' | cut -d' ' -f2 | cut -d';' -f1)
echo "login: ${LOG:+OK}"
echo "POST /series cu sesiune: $(curl -s -o /dev/null -w '%{http_code}' "$B/api/series" -H "Cookie: $LOG" -H "Origin: $B")  (fără: $(curl -s -o /dev/null -w '%{http_code}' "$B/api/series" -H "Origin: $B"))"
echo "cerere de cod (mod deschis): $(curl -s -X POST "$B/api/invite-requests" -H "Content-Type: application/json" -H "Origin: $B" -d '{"email":"x@y.z","message":"nu mai e nevoie de cod oricum"}' | jq -c '.error' )"
echo "login.html: noindex=$(curl -s "$B/login" | grep -c 'noindex') (0 = gasibil pe Google)"

echo ""
echo "═══ CURATENIE ═══"
PID=$(q "SELECT id FROM users WHERE username = '${USR}'" | jq -r '.result[0].results[0].id // empty')
[ -n "$PID" ] && q "DELETE FROM users WHERE id = ${PID}" | jq -c '{success}'
q "SELECT COUNT(*) AS users FROM users" | jq -c '.result[0].results[0]'

echo ""
echo "── still alive ──"
for p in / /login /register; do echo "  $p -> $(curl -s -o /dev/null -w '%{http_code}' "$B$p")"; done
