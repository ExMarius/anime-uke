#!/usr/bin/env bash
set -uo pipefail
echo "── deploy split CSS ──"
./deploy.sh
echo "exit deploy: $?"
echo "── foile live ──"
for f in style page-episode page-admin page-user; do
  echo "$f.css: $(curl -s -o /dev/null -w '%{http_code} %{size_download}B' "https://anime-uke.pages.dev/assets/css/$f.css")"
done
echo "── index NU încarcă foile per-pagină ──"
curl -s https://anime-uke.pages.dev/ | grep -c "page-episode\|page-admin\|page-user" || true
echo "── episode/profile își încarcă foile ──"
curl -s https://anime-uke.pages.dev/episode | grep -o "page-episode.css" | head -1
curl -s https://anime-uke.pages.dev/profile | grep -o "page-user.css" | head -1
echo "── pagini cheie ──"
for u in / /series /episode /login /register /profile /shop; do
  echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev$u)"
done
