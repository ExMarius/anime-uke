#!/usr/bin/env bash
set -uo pipefail
./deploy.sh
echo "exit deploy: $?"

echo
echo "── compatibilitate wrangler (upgrade 4.84.1 → 4.131.2) ──"
echo "  wrangler pe runner: $(npx wrangler --version 2>/dev/null | tail -1)"
echo "  marker 'No migrations to apply' in /tmp/mig.txt: $(grep -c 'No migrations to apply' /tmp/mig.txt 2>/dev/null || echo 0)"
echo "  marker 'Uploaded anime-uke-do' sau 'Current Version ID' in /tmp/wdo.txt: $(grep -cE 'Uploaded anime-uke-do|Current Version ID' /tmp/wdo.txt 2>/dev/null || echo 0)"
echo "  Total Upload gasit: $(grep -oE 'Total Upload: [^ ]*' /tmp/wdo.txt 2>/dev/null | head -1)"
echo "  URL pages.dev extras din /tmp/pages.txt: $(grep -oE 'https://[a-z0-9.-]*\.pages\.dev' /tmp/pages.txt 2>/dev/null | head -1)"
echo "  JWT_SECRET in 'pages secret list': $(npx wrangler pages secret list --project-name=anime-uke 2>/dev/null | grep -c 'JWT_SECRET' || echo 0)"
echo "  migrari neaplicate remote (trebuie 0): $(npx wrangler d1 migrations list DB --remote 2>/dev/null | grep -c '0025' || true)"

B="https://anime-uke.pages.dev"
echo
echo "── verificare live ──"
echo "  / status: $(curl -s "$B/" -o /dev/null -w '%{http_code}')"
echo "  /api/auth/me (fara sesiune) status: $(curl -s "$B/api/auth/me" -o /dev/null -w '%{http_code}')"
echo "  /api/admin/mods GET fara sesiune: $(curl -s "$B/api/admin/mods" -o /dev/null -w '%{http_code}') (401 = ruta exista si e protejata; 405 ar fi bug)"
for C in ubadge--admin ubadge--mod ubadge--staff ubadge--helper; do echo "  style.css $C: $(curl -s "$B/assets/css/style.css" | grep -c "$C")"; done
echo "  core.js staffIcon: $(curl -s "$B/assets/js/core.js" | grep -c 'staffIcon')"
echo "  page-episode.js can_moderate: $(curl -s "$B/assets/js/page-episode.js" | grep -c 'can_moderate')"
echo "  /serie/1019 SSR status: $(curl -s "$B/serie/1019" -o /dev/null -w '%{http_code}')"
echo "  versionare assete in index.html: $(curl -s "$B/" | grep -oE 'assets/(css|js)/[A-Za-z0-9_.-]+\.(css|js)\?v=[a-z0-9]+' | head -2 | tr '\n' ' ')"
