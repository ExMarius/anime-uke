#!/usr/bin/env bash
set -uo pipefail
echo "── deploy optimizări finale ──"
./deploy.sh
echo "exit deploy: $?"
echo "── speculationrules.json ──"
curl -s -o /dev/null -w "status=%{http_code} tip=%{content_type}\n" https://anime-uke.pages.dev/speculationrules.json
echo "── toate apelurile unui vizitator anonim (trebuie toate 200) ──"
for u in /api/me /api/series /api/top /api/recent /api/pulse /api/genres; do
  echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' "https://anime-uke.pages.dev$u")"
done
echo "── HTML fără script inline ──"
curl -s https://anime-uke.pages.dev/ | grep -c 'type="speculationrules"' || true
echo "── imagini comprimate (live) ──"
curl -s -o /dev/null -w "one-piece.jpg: %{size_download}B\n" https://anime-uke.pages.dev/covers/one-piece.jpg
curl -s -o /dev/null -w "hero-1.jpg: %{size_download}B\n" https://anime-uke.pages.dev/assets/img/hero-1.jpg
