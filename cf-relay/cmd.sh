#!/usr/bin/env bash
# Proba de stare a productiei (statusuri HTTP, fara date sensibile).
set -uo pipefail
check() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$2")
  printf '%-44s -> HTTP %s\n' "$1" "$code"
}
check "homepage (302 = privat, ok)"        "https://anime-uke.pages.dev/"
check "API missions fara auth (401 ok)"    "https://anime-uke.pages.dev/api/missions"
check "API economy fara auth (401 ok)"     "https://anime-uke.pages.dev/api/economy"
check "CSS: economie noua live (200)"      "https://anime-uke.pages.dev/assets/css/style.css"
check "sitemap"                            "https://anime-uke.pages.dev/sitemap.xml"
echo "── CSS contine clasele noi (misiuni/rang)? ──"
CSS=$(curl -s "https://anime-uke.pages.dev/assets/css/style.css")
for cls in ".mission__fill" ".econ__rank" ".howto__card"; do
  if echo "$CSS" | grep -q "$cls"; then echo "✓ $cls prezent"; else echo "✗ $cls LIPSA"; fi
done
