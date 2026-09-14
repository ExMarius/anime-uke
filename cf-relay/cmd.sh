#!/usr/bin/env bash
set -uo pipefail
./deploy.sh
echo "exit deploy: $?"

B="https://anime-uke.pages.dev"
echo
echo "── verificare post-deploy (migrarea 0025 + grade de staff) ──"
echo "  migrari ramase neaplicate (trebuie 0 randuri 0025):"
npx wrangler d1 migrations list DB --remote 2>/dev/null | grep -c "0025" || true
echo "  /admin fara sesiune: $(curl -s "$B/admin" -o /dev/null -w '%{http_code}') (302 = protejat, normal)"
echo "  page-admin.js setStaffRole/admin/mods: $(curl -s "$B/assets/js/page-admin.js" | grep -c 'admin/mods')"
echo "  core.js staffIcon:           $(curl -s "$B/assets/js/core.js" | grep -c 'staffIcon')"
for C in ubadge--admin ubadge--mod ubadge--staff ubadge--helper; do echo "  style.css $C: $(curl -s "$B/assets/css/style.css" | grep -c "$C")"; done
echo "  /api/admin/mods fara sesiune: $(curl -s "$B/api/admin/mods" -o /dev/null -w '%{http_code}') (401/403 = protejat, normal)"
# clasamentul (public) selecteaza u.staff_role => 200 doar daca migrarea 0025 e aplicata
echo "  /api/leaderboard status: $(curl -s "$B/api/leaderboard" -o /dev/null -w '%{http_code}') (200 = SELECT-ul cu staff_role merge)"
