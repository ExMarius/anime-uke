#!/usr/bin/env bash
# =====================================================================
# cf-relay/cmd.sh — DEPLOY COMPLET in productie (deploy.sh).
# Ruleaza pe runnerul GitHub, care are acces la api.cloudflare.com.
# Output-ul complet ajunge in cf-relay/last-output.txt.
# =====================================================================
set -uo pipefail

export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN}"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID}"

echo "── deploy: D1 + Worker DO + Pages + secret ──"
./deploy.sh
echo "exit deploy.sh: $?"
