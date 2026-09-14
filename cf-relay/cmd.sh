#!/usr/bin/env bash
set -uo pipefail
BASE="https://anime-uke.pages.dev"

echo "================ VERIFICARE SITE ================"
echo "ora: $(date -u +'%Y-%m-%d %H:%M:%S UTC')"
echo ""

# --- Pagini statice ---
echo "── Pagini (HTTP status) ──"
for p in "/" "/index.html" "/series.html" "/episode.html" "/login.html" "/register.html" "/admin.html"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 20 "${BASE}${p}")
  printf "  %-18s -> %s\n" "${p}" "${code}"
done

echo ""
echo "── Pagina principala ──"
curl -s -m 20 "${BASE}/" | grep -o '<title>[^<]*</title>' || echo "  (niciun <title> gasit)"

# --- Headere de securitate ---
echo ""
echo "── Headere securitate (de pe /) ──"
curl -sSI -m 20 "${BASE}/" | grep -iE '^(HTTP|content-security-policy|x-frame-options|strict-transport-security|x-content-type-options|referrer-policy|permissions-policy)' || echo "  (niciun header gasit)"

# --- API public ---
echo ""
echo "── API public ──"
sr=$(curl -s -m 20 "${BASE}/api/series")
echo "  /api/series: ${#sr} bytes"
echo "  primele 120 car.: $(echo "$sr" | head -c 120)"
me=$(curl -s -m 20 "${BASE}/api/auth/me")
echo "  /api/auth/me: ${me}"

# --- Assete ---
echo ""
echo "── Assete statice ──"
for a in "/assets/css/style.css" "/assets/js/core.js" "/_worker.js"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 20 "${BASE}${a}")
  printf "  %-24s -> %s\n" "${a}" "${code}"
done

# --- Cai blocate (trebuie 404) ---
echo ""
echo "── Cai blocate (asteptam 404) ──"
for b in "/wrangler.toml" "/schema.sql" "/.dev.vars" "/migrations/0001_init.sql"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 20 "${BASE}${b}")
  printf "  %-28s -> %s\n" "${b}" "${code}"
done

echo ""
echo "================ SFARSIT VERIFICARE ================"
