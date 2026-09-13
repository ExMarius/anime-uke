#!/usr/bin/env bash
# =====================================================================
# cf-relay/cmd.sh — comanda rulata de workflow-ul cloudflare-relay.
# BATCH 2 — diagnoza permisiuni: afiseaza si erorile API, nu doar result.
# REPO PUBLIC: doar ID-uri/statusuri, fara date de utilizatori sau secrete.
# =====================================================================
set -uo pipefail

api() { # api <metoda> <cale> [body]
  local M="$1" P="$2" B="${3:-}"
  if [ -n "$B" ]; then
    curl -sS -X "$M" "https://api.cloudflare.com/client/v4${P}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" -d "$B"
  else
    curl -sS -X "$M" "https://api.cloudflare.com/client/v4${P}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
  fi
}

proba() { # proba <nume> <json>
  echo "── ${1} ──"
  echo "$2" | jq '{success, errors: [.errors[]? | {code, message}], rezumat: (
    if .result == null then null
    elif (.result | type) == "array" then (.result | length | tostring) + " elemente"
    else "ok"
    end)}'
  echo "$2" | jq -c '.result' 2>/dev/null | head -c 2000; echo
}

A="/accounts/${CLOUDFLARE_ACCOUNT_ID}"

proba "verify token"     "$(api GET /user/tokens/verify)"
proba "cont"             "$(api GET /accounts)"
proba "D1 — lista"       "$(api GET ${A}/d1/database?per_page=25)"
proba "Pages — proiecte" "$(api GET ${A}/pages/projects)"
proba "Workers — scripturi" "$(api GET ${A}/workers/scripts)"
echo "── wrangler whoami ──"
npx wrangler whoami 2>&1 | tail -12
exit 0
