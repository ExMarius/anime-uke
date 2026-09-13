#!/usr/bin/env bash
# CURATENIE + DEPLOY: 1) stergem baza veche anime-auth-db (nefolosita din
# aprilie, nicio configuratie nu o refera) 2) deploy complet.
set -uo pipefail
A="/accounts/${CLOUDFLARE_ACCOUNT_ID}"
H="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"

echo "── 1) stergere anime-auth-db (b62d35da-e01d-4e57-a06a-5c543a52927f) ──"
curl -sS -X DELETE "${A}/d1/database/b62d35da-e01d-4e57-a06a-5c543a52927f" \
  -H "$H" | jq '{success, errors: [.errors[]?.message]}'
echo "── lista ramasa ──"
curl -sS "${A}/d1/database" -H "$H" | jq '.result[] | {name, uuid}'

echo "── 2) deploy complet ──"
./deploy.sh
echo "exit deploy: $?"
