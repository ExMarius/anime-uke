#!/usr/bin/env bash
set -uo pipefail
./deploy.sh
echo "exit deploy: $?"

B="https://anime-uke.pages.dev"
echo
echo "── verificare post-deploy (migrarea 0025 + grade de staff) ──"
echo "  migrari ramase neaplicate (trebuie 0 randuri 0025):"
npx wrangler d1 migrations list DB --remote 2>/dev/null | grep -c "0025" || true
echo "  admin.html 'Grade de staff': $(curl -s "$B/admin" | grep -c 'Grade de staff')"
echo "  admin.html #mod-role:        $(curl -s "$B/admin" | grep -c 'id="mod-role"')"
echo "  admin.html 'Teme de nivel':  $(curl -s "$B/admin" | grep -c 'Teme de nivel')"
echo "  core.js staffIcon:           $(curl -s "$B/assets/js/core.js" | grep -c 'staffIcon')"
echo "  style.css ubadge--helper:    $(curl -s "$B/assets/css/style.css" | grep -c 'ubadge--helper')"
echo "  /api/admin/mods fara sesiune: $(curl -s "$B/api/admin/mods" -o /dev/null -w '%{http_code}') (401/403 = protejat, normal)"
# profilul public trebuie sa raspunda 200 (SELECT-ul cu staff_role merge => coloana exista)
P=$(curl -s "$B/api/profile/admin" -w '\n%{http_code}')
echo "  /api/profile/<user> status: $(echo "$P" | tail -1) staff_role prezent: $(echo "$P" | head -1 | grep -c 'staff_role')"
