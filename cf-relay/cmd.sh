#!/usr/bin/env bash
# =====================================================================
# cf-relay/cmd.sh — verificare POST-DEPLOY a productiei.
# Doar statusuri HTTP — fara continut sensitiv (repo public).
# =====================================================================
set -uo pipefail

check() { # check <nume> <url> [cookie_anonim]
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$2")
  printf '%-42s -> HTTP %s\n' "$1" "$code"
}

echo "── site live ──"
check "homepage (guest -> redirect login)" "https://anime-uke.pages.dev/"
check "sitemap.xml (public)"               "https://anime-uke.pages.dev/sitemap.xml"
check "robots.txt (public)"                "https://anime-uke.pages.dev/robots.txt"
check "style.css v=?v (asset)"             "https://anime-uke.pages.dev/assets/css/style.css"
check "API pulse fara auth (401 asteptat)" "https://anime-uke.pages.dev/api/pulse"
check "worker DO sanatos (chat state)"     "https://anime-uke.pages.dev/chat?state=online"

echo "── sitemap: prima linie + numar de URL-uri ──"
S="$(curl -s https://anime-uke.pages.dev/sitemap.xml)"
echo "$S" | head -2
echo "URL-uri in sitemap: $(echo "$S" | grep -c '<loc>')"

echo "── login flux real (admin test) ──"
CODE=$(curl -s -o /tmp/login-test.json -w '%{http_code}' -X POST https://anime-uke.pages.dev/api/auth/login \
  -H "Content-Type: application/json" -H "Origin: https://anime-uke.pages.dev" \
  -d '{"username":"__nu_exista__","password":"gresit"}')
echo "login cu user inexistent -> HTTP $CODE (401 asteptat): $(cat /tmp/login-test.json)"
rm -f /tmp/login-test.json
