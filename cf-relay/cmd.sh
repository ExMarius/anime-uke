#!/usr/bin/env bash
# Curatenie: stergem baza veche anime-auth-db + proba de stare finala.
set -uo pipefail
H="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
BASE="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"

echo "── stergere anime-auth-db ──"
curl -sS -X DELETE "${BASE}/d1/database/b62d35da-e01d-4e57-a06a-5c543a52927f" -H "$H" \
  | jq '{success, errors: [.errors[]?.message]}'
echo "── bazele ramase ──"
curl -sS "${BASE}/d1/database" -H "$H" | jq '.result[] | {name, uuid}'

echo "── proba de stare ──"
check() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$2")
  printf '%-40s -> HTTP %s\n' "$1" "$code"
}
check "homepage (302 = privat, ok)"    "https://anime-uke.pages.dev/"
check "login (200, cu nav nou)"        "https://anime-uke.pages.dev/login"
check "register (200, cu nav nou)"     "https://anime-uke.pages.dev/register"
check "sitemap"                        "https://anime-uke.pages.dev/sitemap.xml"
