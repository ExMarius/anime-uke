#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
W="$PWD/node_modules/.bin/wrangler"; [ -x "$W" ] || W="npx wrangler"
D="https://anime-uke.pages.dev"
st() { curl -s -o /dev/null -w "%{http_code}" "$D$1"; }
echo "== PAGINI PUBLICE (astept 200) =="
for p in / /series /login /register /robots.txt /sitemap.xml /llms.txt /speculationrules.json; do echo "$p -> $(st $p)"; done
echo "== PAGINI PRIVATE (astept 302 la login) =="
for p in /profile /shop /admin; do echo "$p -> $(st $p)"; done
echo "== ASSETS (200) =="
for p in /assets/css/style.css /assets/css/page-user.css /assets/js/core.js /assets/js/page-index.js /assets/js/page-series.js /assets/js/page-profile.js /assets/js/page-episode.js /assets/js/page-shop.js /assets/js/chat.js /assets/js/auth.js; do echo "$p -> $(st $p)"; done
echo "== API PUBLIC (200) =="
for p in "/api/series?limit=1" /api/genres /api/recent /api/top /api/pulse /api/ranks /api/auth/me; do echo "$p -> $(st "$p")"; done
echo "== API UTILIZATOR (astept 401) =="
for p in /api/leaderboard /api/factions /api/economy /api/missions /api/watchlist /api/chest /api/notifications/unread /api/continue; do echo "$p -> $(st "$p")"; done
echo "== API ADMIN (nu trebuie 200) =="
for p in /api/admin/stats /api/admin/reports /api/admin/log; do echo "$p -> $(st "$p")"; done
echo "== SEO =="
echo "robots: $(curl -s $D/robots.txt | grep -ci sitemap) (1=are sitemap)"
echo "sitemap serii: $(curl -s $D/sitemap.xml | grep -c '<loc>') loc-uri"
echo "== D1 =="
$W d1 execute anime-db --remote --json --command "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM series) AS series, (SELECT COUNT(*) FROM episodes) AS episodes, (SELECT COUNT(*) FROM rank_themes) AS teme, (SELECT COUNT(*) FROM faction_rep) AS frep, (SELECT COUNT(*) FROM faction_winners) as fwin, (SELECT COUNT(*) FROM lb_prizes) as lbprizes" 2>/dev/null | grep -E '"(users|series|episodes|teme|frep|fwin|lbprizes)"'
