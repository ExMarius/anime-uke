#!/usr/bin/env bash
# Sweep cu cont de proba (fara redeploy — doar verificari + curatenie).
set -uo pipefail
B="https://anime-uke.pages.dev"
H="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
DB="7209b0bd-227b-46d0-b376-6157b56734fa"
API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${DB}/query"
q() { curl -sS -X POST "$API" -H "$H" -H "Content-Type: application/json" -d "{\"sql\": \"$1\"}"; }

# cod robust: din base64 (A-Z 2-9), fara head-causing-SIGPIPE
RAW=$(head -c 256 /dev/urandom | base64 | tr -dc '2-9A-HJ-NP-Z' | cut -c1-8)
CODE="AU-${RAW:0:4}-${RAW:4}"
echo "cod generat: $CODE (lungime ${#CODE})"
if [ ${#CODE} -ne 12 ]; then echo "✗ cod invalid, ma opresc"; exit 1; fi

q "INSERT INTO invite_codes (code, note) VALUES ('${CODE}', 'probe audit auto')" | jq -c '{success, errors: [.errors[]?.message]}'

USR="cf_probe_$(date +%s)"
REG=$(curl -s -X POST "$B/api/auth/register" -H "Content-Type: application/json" -H "Origin: $B" \
  -d "{\"username\":\"${USR}\",\"email\":\"${USR}@probe.local\",\"invite_code\":\"${CODE}\",\"password\":\"ParolaProbe123\"}")
echo "register: $(echo "$REG" | head -c 100)"
echo "${USR}" > /tmp/probe-user

C=$(curl -s -i -X POST "$B/api/auth/login" -H "Content-Type: application/json" -H "Origin: $B" \
  -d "{\"username\":\"${USR}\",\"password\":\"ParolaProbe123\"}" | grep -i '^set-cookie' | cut -d' ' -f2 | cut -d';' -f1)
if [ -z "$C" ]; then echo "✗ login probe a picat"; exit 1; fi

echo ""
echo "═══ SWEEP LOGAT ═══"
check() { local c; c=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: $C" -H "Origin: $B" "$B$2"); printf '  %-36s %s\n' "$1" "$c"; }
for p in / /series /profile /shop /admin; do check "$p" "$p"; done
for a in /api/series /api/top /api/continue /api/pulse /api/missions /api/economy /api/leaderboard /api/shop /api/ranks /api/notifications/unread /api/auth/me; do check "$a" "$a"; done

echo "── flux misiune real (comentariu -> progres -> claim) ──"
EP=$(curl -s "$B/api/series" -H "Cookie: $C" -H "Origin: $B" | jq -r '.series[0].id // empty')
if [ -n "$EP" ]; then
  EID=$(curl -s "$B/api/series/$EP" -H "Cookie: $C" -H "Origin: $B" | jq -r '.episodes[0].id // empty')
  if [ -n "$EID" ]; then
    curl -s -X POST "$B/api/comments" -H "Cookie: $C" -H "Origin: $B" -H "Content-Type: application/json" \
      -d "{\"episode_id\": ${EID}, \"body\": \"verificare sisteme (cont proba, se sterge)\"}" | jq -c '{success}'
    P=$(curl -s "$B/api/missions" -H "Cookie: $C" -H "Origin: $B")
    echo "$P" | jq -c '.missions[] | {key, progress, claimed}'
    echo "── claim misiune comentariu ──"
    curl -s -X POST "$B/api/missions" -H "Cookie: $C" -H "Origin: $B" -H "Content-Type: application/json" \
      -d '{"mission": "comment"}' | jq -c '{success, reward}'
  fi
fi

echo ""
echo "═══ CURATENIE ═══"
PID=$(q "SELECT id FROM users WHERE username = '${USR}'" | jq -r '.result[0].results[0].id // empty')
[ -n "$PID" ] && q "DELETE FROM users WHERE id = ${PID}" | jq -c '{success, errors: [.errors[]?.message]}'
q "DELETE FROM invite_codes WHERE code = '${CODE}'" | jq -c '{success, errors: [.errors[]?.message]}'
echo "utilizatori ramasi:"; q "SELECT username FROM users ORDER BY id" | jq -c '[.result[0].results[].username]'
