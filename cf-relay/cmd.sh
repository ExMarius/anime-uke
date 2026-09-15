#!/usr/bin/env bash
set -uo pipefail
B=https://anime-uke.pages.dev
sleep 60   # lasa propagarea Pages sa termine
echo "── re-verificare monetizare (read-only) ──"
echo -n "GET /api/ads: "; curl -s -o /tmp/ads.json -w "%{http_code}" "$B/api/ads"; echo; cat /tmp/ads.json; echo
echo -n "GET /api/admin/ads (fara login): "; curl -s -o /dev/null -w "%{http_code}" "$B/api/admin/ads"; echo
echo -n "ads.js initAds: "; curl -s "$B/assets/js/ads.js" | grep -c "initAds"
echo -n "page-admin ads-slots: "; curl -s "$B/assets/js/page-admin.js" | grep -c "ads-slots"
echo -n "data-ad-slot pe /: "; curl -s "$B/" | grep -c "data-ad-slot"
echo -n "data-ad-slot pe /serie/1: "; curl -s -L "$B/serie/1" | grep -c "data-ad-slot"
echo -n "style.css ad-box: "; curl -s "$B/assets/css/style.css" | grep -c "ad-box"
echo -n "admin.html tab-ads: "; curl -s "$B/admin.html" -L | grep -c "tab-ads"
echo -n "footer fara promisiunea 'fara reclame': "; curl -s "$B/" | grep -c "fără reclame" || true
node scripts/audit-live.mjs "$B"
echo "exit audit: $?"
