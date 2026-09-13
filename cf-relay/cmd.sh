#!/usr/bin/env bash
# DEPLOY + SWEEP cu cont de proba (creeaza -> verifica -> sterge complet).
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
echo "═══ CONT PROBA: creare ═══"
CODE="AU-$(od -An -tx1 /dev/urandom | tr -d ' \n' | tr -dc '2-9A-HJ-NP-Z' | head -c 8)"
CODE="${CODE:0:4}-${CODE:4}"
# insereaza codul in D1 (created_by NULL e permis)
R=$(q "INSERT INTO invite_codes (code, note) VALUES ('${CODE}', 'probe audit auto') RETURNING id")
echo "$R" | jq -c '{success, errors: [.errors[]?.message]}' 
USR="cf_probe_$(date +%s)"
REG=$(curl -s -X POST "$B/api/auth/register" -H "Content-Type: application/json" -H "Origin: $B" \
  -d "{\"username\":\"${USR}\",\"email\":\"${USR}@probe.local\",\"invite_code\":\"${CODE}\",\"password\":\"ParolaProbe123\"}")
echo "register: $(echo "$REG" | head -c 120)"

echo ""
echo "═══ SWEEP LOGAT ═══"
C=$(curl -s -i -X POST "$B/api/auth/login" -H "Content-Type: application/json" -H "Origin: $B" \
  -d "{\"username\":\"${USR}\",\"password\":\"ParolaProbe123\"}" | grep -i '^set-cookie' | cut -d' ' -f2 | cut -d';' -f1)
check() { local c; c=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: $C" -H "Origin: $B" "$B$2"); printf '  %-36s %s\n' "$1" "$c"; }
for p in / /series /profile /shop /admin /login; do check "$p" "$p"; done
for a in /api/series /api/top /api/continue /api/pulse /api/missions /api/economy /api/leaderboard /api/shop /api/ranks /api/notifications/unread /api/auth/me; do check "$a" "$a"; done
echo "── flux misiune real (comentariu -> progres) ──"
EP=$(curl -s "$B/api/series" -H "Cookie: $C" -H "Origin: $B" | jq -r '.series[0].id // empty')
if [ -n "$EP" ]; then
  DET=$(curl -s "$B/api/series/$EP" -H "Cookie: $C" -H "Origin: $B")
  EID=$(echo "$DET" | jq -r '.episodes[0].id // empty')
  if [ -n "$EID" ]; then
    curl -s -X POST "$B/api/comments" -H "Cookie: $C" -H "Origin: $B" -H "Content-Type: application/json" \
      -d "{\"episode_id\": ${EID}, \"body\": \"verificare sisteme (se sterge)\"}" | jq -c '{success}'
    curl -s "$B/api/missions" -H "Cookie: $C" -H "Origin: $B" | jq -c '{comment: (.missions[] | select(.key=="comment") | .progress)}'
  else echo "  (seria are 0 episoade — sar fluxul)"; fi
fi

echo ""
echo "═══ CURATENIE: stergem contul de proba ═══"
PID=$(q "SELECT id FROM users WHERE username = '${USR}'" | jq -r '.result[0].results[0].id // empty')
if [ -n "$PID" ]; then
  q "DELETE FROM users WHERE id = ${PID}" | jq -c '{success, errors: [.errors[]?.message]}'
fi
q "DELETE FROM invite_codes WHERE code = '${CODE}'" | jq -c '{success, errors: [.errors[]?.message]}'
q "SELECT COUNT(*) AS n FROM users" | jq -c '.result[0].results[0]'
