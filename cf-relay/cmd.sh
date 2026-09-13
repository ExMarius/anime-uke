#!/usr/bin/env bash
# =====================================================================
# cf-relay/cmd.sh — BATCH 4: query real pe D1 productie (doar COUNT-uri
# agregate — fara date personale, repo-ul e public).
# =====================================================================
set -uo pipefail

DB_UUID="7209b0bd-227b-46d0-b376-6157b56734fa"   # anime-db
A="/accounts/${CLOUDFLARE_ACCOUNT_ID}"
Q() { # Q <sql>  — ruleaza query pe anime-db
  curl -sS -X POST "https://api.cloudflare.com/client/v4${A}/d1/database/${DB_UUID}/query" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"sql\": \"$1\"}" | jq '{success, errors: [.errors[]?|.message], rows: .result[0].results}'
}

echo "── tabele din anime-db ──"
Q "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"

echo "── numaratoare agregate ──"
for t in users series episodes comments chat_messages reports invites; do
  printf '%-16s ' "$t:"
  Q "SELECT COUNT(*) AS n FROM $t" 2>/dev/null | jq -r '.rows[0].n // "—"' || echo "—"
done

echo "── migrari aplicate ──"
Q "SELECT name FROM d1_migrations ORDER BY id" 2>/dev/null | jq -c '.rows' 2>/dev/null || echo "(tabela d1_migrations nu exista)"
exit 0
