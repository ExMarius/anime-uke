#!/usr/bin/env bash
# =====================================================================
# cf-relay/cmd.sh — comanda pe care o ruleaza workflow-ul cloudflare-relay
# pe runnerul GitHub la fiecare push pe branch-ul arena/**.
#
# Fiecare comanda suprascrie acest fisier; istoricul git pastreaza ce
# s-a rulat si cand. Output-ul apare in logul workflow-ului:
#   gh run view --log  (sau tab-ul Actions pe GitHub)
# =====================================================================
set -euo pipefail

echo "── verify token ──"
curl -sS "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | jq .

echo "── conturi accesibile ──"
curl -sS "https://api.cloudflare.com/client/v4/accounts" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  | jq '.result[] | {id, name}'
