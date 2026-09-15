#!/usr/bin/env bash
set -uo pipefail
echo "=== Verifica Bot Fight Mode si sitemap GSC ==="
echo "Account ID: $CLOUDFLARE_ACCOUNT_ID"
echo
echo "Lista Pages projects:"
curl -sS "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq -r '.result[] | "\(.name) \(.id)"' | head -20
echo
echo "Bot Management (account level):"
curl -sS "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/bot_management" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq .
echo
echo "--- sitemap tests ---"
B="https://anime-uke.pages.dev"
curl -s -I -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" "$B/sitemap.xml" | head -10
curl -s -A "Googlebot" "$B/sitemap.xml" | head -20
echo
echo "--- deploy anyway ---"
./deploy.sh
echo "exit deploy: $?"
curl -s -I "$B/sitemap.xml" | head -10
curl -s "$B/sitemap.xml" | head -20
