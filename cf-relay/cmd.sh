#!/usr/bin/env bash
set -uo pipefail
./deploy.sh
echo "exit deploy: $?"

B="https://anime-uke.pages.dev"
echo
echo "── verificare post-deploy (migrarea 0024 + fisa detaliata) ──"
# Coloanele noi trebuie sa apara in raspunsul public al seriei (goale, dar prezente).
S=$(curl -s "$B/api/series/1019")
for K in alt_titles themes age_rating ep_duration release_date country external_url team next_ep_note next_ep_at; do
  echo "  /api/series/1019 are cheia $K: $(echo "$S" | grep -c "\"$K\"")"
done
# Markup-ul nou a ajuns pe edge?
echo "  series.html #series-info: $(curl -s "$B/serie/1019" | grep -c 'id="series-info"')"
echo "  series.html #next-ep:     $(curl -s "$B/serie/1019" | grep -c 'id="next-ep"')"
echo "  episode.html #comments-sort: $(curl -s "$B/episode" | grep -c 'id="comments-sort"')"
echo "  chat.js regulament: $(curl -s "$B/assets/js/chat.js" | grep -c 'auk-chat-rules-v1')"
echo "  admin/serie.html fisa: $(curl -s "$B/admin/serie/1019" -o /dev/null -w '%{http_code}') (302 = protejat, normal)"
