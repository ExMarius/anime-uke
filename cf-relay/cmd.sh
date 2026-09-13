#!/usr/bin/env bash
# Re-verificare: rutele de invitație trebuie să fie moarte (401 anonim / 404 admin).
set -uo pipefail
B="https://anime-uke.pages.dev"
echo "POST /api/invite-requests (anonim)  -> $(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/invite-requests" -H "Origin: $B" -H "Content-Type: application/json" -d '{}')"
echo "GET  /api/invite-requests (anonim)  -> $(curl -s -o /dev/null -w '%{http_code}' "$B/api/invite-requests?code=RQ-ZZZZ-ZZZZ" -H "Origin: $B")"
echo "POST /api/admin/invites   (anonim)  -> $(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/admin/invites" -H "Origin: $B" -H "Content-Type: application/json" -d '{}')"
echo "portalul pe /login        -> $(curl -s "$B/login" | grep -c 'cere-cod') aparitii (0 = plecat)"
echo "câmpul de cod pe /register-> $(curl -s "$B/register" | grep -c 'invite_code') aparitii (0 = plecat)"
echo "register-options          -> $(curl -s "$B/api/auth/register-options" -H "Origin: $B" | jq -c '.')"
echo "sanitate: /login -> $(curl -s -o /dev/null -w '%{http_code}' "$B/login")"
