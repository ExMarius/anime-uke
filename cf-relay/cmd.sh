#!/usr/bin/env bash
# =====================================================================
# cf-relay/cmd.sh — comanda rulata de workflow-ul cloudflare-relay.
# Scrie comanda dorita aici; istoricul pastreaza ce s-a rulat.
# Default: proba de stare a productiei (statusuri HTTP, fara date sensibile).
# =====================================================================
set -uo pipefail

check() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$2")
  printf '%-40s -> HTTP %s\n' "$1" "$code"
}

check "homepage (302 = privat, ok)"  "https://anime-uke.pages.dev/"
check "sitemap.xml"                  "https://anime-uke.pages.dev/sitemap.xml"
check "robots.txt"                   "https://anime-uke.pages.dev/robots.txt"
check "API pulse (401 fara auth ok)" "https://anime-uke.pages.dev/api/pulse"
check "API series (401 fara auth ok)" "https://anime-uke.pages.dev/api/series"
