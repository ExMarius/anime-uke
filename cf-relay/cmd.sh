#!/usr/bin/env bash
set -uo pipefail
# HEAD la momentul deploy-ului = valoarea pe care deploy.sh o pune in ?v=
# (runner-ul va mai comite inca un commit dupa asta, cu output-ul).
V="$(git rev-parse --short HEAD)"
./deploy.sh
echo "exit deploy: $?"

B="https://anime-uke.pages.dev"
echo
echo "── verificare live (deploy din commitul $V) ──"
echo "  wrangler pe runner: $(npx wrangler --version 2>/dev/null | tail -1)"
echo "  migrari neaplicate remote (trebuie 0): $(npx wrangler d1 migrations list DB --remote 2>/dev/null | grep -c '0025' || true)"
echo "  / status: $(curl -s "$B/" -o /dev/null -w '%{http_code}')"
echo "  ?v= din index.html live (trebuie sa contina $V): $(curl -s "$B/" | grep -oE 'assets/(css|js)/[A-Za-z0-9_.-]+\.(css|js)\?v=[a-z0-9]+' | head -2 | tr '\n' ' ')"
echo "  /api/auth/me (fara sesiune): $(curl -s "$B/api/auth/me" -o /dev/null -w '%{http_code}')"
echo "  /api/admin/mods GET fara sesiune: $(curl -s "$B/api/admin/mods" -o /dev/null -w '%{http_code}') (401 = ruta exista si e protejata; 405 ar fi bug)"
echo "  /api/leaderboard: $(curl -s "$B/api/leaderboard" -o /dev/null -w '%{http_code}')"
echo "  /api/factions: $(curl -s "$B/api/factions" -o /dev/null -w '%{http_code}')"
for C in ubadge--admin ubadge--mod ubadge--staff ubadge--helper; do echo "  style.css $C: $(curl -s "$B/assets/css/style.css" | grep -c "$C")"; done
echo "  core.js staffIcon: $(curl -s "$B/assets/js/core.js" | grep -c 'staffIcon')"
echo "  page-episode.js can_moderate: $(curl -s "$B/assets/js/page-episode.js" | grep -c 'can_moderate')"
echo "  /serie/1019 SSR status: $(curl -s "$B/serie/1019" -o /dev/null -w '%{http_code}')"
echo "  /sitemap.xml: $(curl -s "$B/sitemap.xml" -o /dev/null -w '%{http_code}')  /robots.txt: $(curl -s "$B/robots.txt" -o /dev/null -w '%{http_code}')"
