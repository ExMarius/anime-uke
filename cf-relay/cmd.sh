#!/usr/bin/env bash
set -uo pipefail
./deploy.sh
echo "exit deploy: $?"

B=https://anime-uke.pages.dev
echo "── verificari post-deploy: monetizare ──"

# 1. endpointul public exista si e oprit implicit
echo -n "GET /api/ads: "
curl -s -o /tmp/ads.json -w "%{http_code}" "$B/api/ads"; echo
cat /tmp/ads.json; echo

# 2. endpointul de admin cere autentificare
echo -n "GET /api/admin/ads (fara login): "
curl -s -o /dev/null -w "%{http_code}" "$B/api/admin/ads"; echo

# 3. JS-ul de reclame e servit si contine markerii (identificatori, nu comentarii)
echo -n "ads.js initAds: "
curl -s "$B/assets/js/ads.js" | grep -c "initAds"
echo -n "page-admin bundle contine ads-slots: "
curl -s "$B/assets/js/page-admin.js" | grep -c "ads-slots"

# 4. sloturile exista in HTML
for p in / ; do
  echo -n "data-ad-slot pe $p: "
  curl -s "$B$p" | grep -c "data-ad-slot"
done

# 5. CSS-ul pastreaza clasele dinamice dupa purge
echo -n "style.css ad-box: "
curl -s "$B/assets/css/style.css" | grep -c "ad-box"

# 6. tabul de admin e in HTML
echo -n "admin.html tab-ads: "
curl -s "$B/admin" -L -o /dev/null -w "%{http_code}"; echo

# 7. audit complet
node scripts/audit-live.mjs "$B"
echo "exit audit: $?"
