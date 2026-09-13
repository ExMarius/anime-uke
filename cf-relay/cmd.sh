#!/usr/bin/env bash
# Proba de stare a productiei (statusuri HTTP, fara date sensibile).
set -uo pipefail
check() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$2")
  printf '%-40s -> HTTP %s\n' "$1" "$code"
}
check "homepage (302 = privat, ok)"   "https://anime-uke.pages.dev/"
check "API profile (401 fara auth ok)" "https://anime-uke.pages.dev/api/profile/x"
check "API chat state (401/200 ok)"   "https://anime-uke.pages.dev/chat?state=online"
check "sitemap"                       "https://anime-uke.pages.dev/sitemap.xml"
