#!/usr/bin/env bash
set -uo pipefail
# Activez monetizarea A-ADS (ad unit 2455410) direct in D1 remote.
# Scriu in site_settings exact JSON-ul pe care l-ar fi salvat POST /api/admin/ads
# (aceeasi forma normalizata din validateAdsConfig).
npm ci >/dev/null 2>&1
W="$PWD/node_modules/.bin/wrangler"

CONFIG='{"enabled":true,"hide_for_staff":true,"slots":{"index":{"enabled":true,"type":"iframe","url":"https://acceptable.a-ads.com/2455410/?size=Adaptive","width":728,"height":90,"label":""},"series":{"enabled":true,"type":"iframe","url":"https://acceptable.a-ads.com/2455410/?size=Adaptive","width":468,"height":60,"label":""},"episode":{"enabled":true,"type":"iframe","url":"https://acceptable.a-ads.com/2455410/?size=Adaptive","width":728,"height":90,"label":""}}}'
SQL="INSERT INTO site_settings (key, value, updated_at) VALUES ('ads', '$CONFIG', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;"

"$W" d1 execute anime-db --remote --config wrangler.prod.toml --command "$SQL" && echo "D1: config ads scris"
"$W" d1 execute anime-db --remote --config wrangler.prod.toml --command "SELECT key, length(value) AS len, updated_at FROM site_settings WHERE key='ads';"

B=https://anime-uke.pages.dev
echo "── verificare live ──"
# cache-ul de setari e 5 min per izolat; incerc de cateva ori
for i in 1 2 3 4 5 6; do
  RES=$(curl -s "$B/api/ads")
  echo "incercarea $i: $RES" | head -c 300; echo
  echo "$RES" | grep -q '"enabled":true' && break
  sleep 45
done
echo -n "slotul index e servit cu URL-ul A-ADS: "
curl -s "$B/api/ads" | grep -c "acceptable.a-ads.com/2455410"
