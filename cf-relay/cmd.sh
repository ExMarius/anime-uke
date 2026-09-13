#!/usr/bin/env bash
# =====================================================================
# cf-relay/cmd.sh — comanda pe care o ruleaza workflow-ul cloudflare-relay
# pe runnerul GitHub la fiecare push care modifica acest fisier.
# Fiecare comanda noua suprascrie acest fisier; istoricul git pastreaza
# ce s-a rulat. Output-ul ajunge in cf-relay/last-output.txt.
#
# REPO PUBLIC: aici nu se afiseaza niciodata date de utilizatori sau
# valori de secrete — doar ID-uri, statusuri, numaratoari.
# =====================================================================
set -euo pipefail

echo "── verify token ──"
curl -sS "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  | jq '{success, status: .result.status, error: .errors[0].message}'

echo "── conturi accesibile ──"
curl -sS "https://api.cloudflare.com/client/v4/accounts" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  | jq '.result[] | {id, name}'

echo "── baze de date D1 ──"
curl -sS "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  | jq '.result[] | {uuid, name, version, num_tables, file_size}'

echo "── proiecte Pages ──"
curl -sS "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  | jq '.result[] | {name, subdomain, domains}'

echo "── wrangler whoami ──"
npx wrangler whoami 2>&1 | tail -8
