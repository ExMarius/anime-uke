#!/usr/bin/env bash
set -uo pipefail
./deploy.sh
echo "exit deploy: $?"

B="https://anime-uke.pages.dev"
echo
echo "── verificare post-deploy (curatenie + grade) ──"
echo "  migrari neaplicate care contin 0025 (trebuie 0): $(npx wrangler d1 migrations list DB --remote 2>/dev/null | grep -c '0025' || true)"
echo "  /api/auth/me (fara sesiune) status: $(curl -s "$B/api/auth/me" -o /dev/null -w '%{http_code}')"
echo "  /api/admin/mods GET fara sesiune: $(curl -s "$B/api/admin/mods" -o /dev/null -w '%{http_code}') (401 = ruta exista si e protejata; 405 ar fi bug)"
echo "  /schema.sql: $(curl -s "$B/schema.sql" -o /dev/null -w '%{http_code}') (404 normal)"
echo "  /covers/naruto.jpg: $(curl -s "$B/covers/naruto.jpg" -o /dev/null -w '%{http_code}') (404/302 normal, fisierele nu mai exista)"
for C in ubadge--admin ubadge--mod ubadge--staff ubadge--helper; do echo "  style.css $C: $(curl -s "$B/assets/css/style.css" | grep -c "$C")"; done
echo "  core.js staffIcon: $(curl -s "$B/assets/js/core.js" | grep -c 'staffIcon')"
echo "  page-episode.js can_moderate: $(curl -s "$B/assets/js/page-episode.js" | grep -c 'can_moderate')"
echo "  /serie/1019 SSR status: $(curl -s "$B/serie/1019" -o /dev/null -w '%{http_code}')"
