#!/usr/bin/env bash
set -uo pipefail
# Verificare read-only pe live: chiar rulează codul nou în bundle-urile minificate?
# (Comentariile se pierd la minificare, deci căutăm string-uri literale.)

B="https://anime-uke.pages.dev"
V="$(curl -s "$B/" | grep -o 'assets/js/page-index.js?v=[A-Za-z0-9._-]*' | head -1 | cut -d= -f2)"
JS="$(curl -s "$B/assets/js/page-index.js?v=$V")"

echo "versiune din HTML: ?v=$V   (bundle: $(echo -n "$JS" | wc -c) B)"
echo
echo "── markeri în bundle-ul live al primei pagini ──"
echo "   fetch /api/home          : $(echo "$JS" | grep -c '"/home"')  (așteptat ≥1)"
echo "   fără /api/series la start: $(echo "$JS" | grep -o '"/series?"' | wc -l)  (0 = nu mai cheltuie o cerere separată)"
echo "   /api/pulse în bundle     : $(echo "$JS" | grep -c '"/pulse"')  (1 = codul din core.js pentru celelalte pagini; pe / NU se cheltuie, vezi dom-smoke)"
echo "   lista HERO .webp         : $(echo "$JS" | grep -c 'hero-1\.webp')  (≥1 = imaginea cerută direct)"
echo "   hero .jpg în bundle      : $(echo "$JS" | grep -c 'hero-1\.jpg')  (1 = doar rezerva din scara de erori, nu o cerere la încărcare)"
echo
echo "── /api/home pe live (de două ori, ca să excludem propagarea de edge) ──"
for i in 1 2; do
  echo "   încercarea $i: $(curl -s -o /tmp/h$i.json -w '%{http_code} %{time_total}s' "$B/api/home") · $(head -c 90 /tmp/h$i.json)"
done
echo "   secțiuni: $(node -e 'const j=JSON.parse(require("fs").readFileSync("/tmp/h2.json","utf8"));console.log(Object.keys(j).join(", "), "· serii:", j.series.series.length, "· recent:", j.recent.length, "· genuri:", j.genres.length)')"
echo
echo "── cota consumată azi (UTC) ──"
node scripts/usage.mjs
