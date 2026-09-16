#!/usr/bin/env bash
set -uo pipefail
echo "=== Debug Pages project + sitemap GSC ==="
echo "Account: $CLOUDFLARE_ACCOUNT_ID"
echo
echo "Pages project anime-uke details:"
curl -sS "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/anime-uke" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq .
echo
echo "--- sitemap fetch tests from GitHub runner ---"
B="https://anime-uke.pages.dev"
for ua in "Mozilla/5.0" "Googlebot" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" "Mozilla/5.0 (compatible; bingbot/2.0)"; do
  echo "UA: $ua"
  curl -s -o /dev/null -w "%{http_code} %{content_type}\n" -A "$ua" "$B/sitemap.xml"
done
echo
echo "--- robots.txt ---"
curl -s "$B/robots.txt"
echo
echo "--- sitemap.xml raw ---"
curl -s "$B/sitemap.xml"
echo
echo "--- sitemap.txt raw ---"
curl -s "$B/sitemap.txt"
