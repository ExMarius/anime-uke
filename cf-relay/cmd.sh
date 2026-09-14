#!/usr/bin/env bash
set -uo pipefail
echo "── JS servit: mărime + sintaxă validă ──"
for f in core.js page-index.js; do
  curl -s "https://anime-uke.pages.dev/assets/js/$f" -o /tmp/$f
  echo "$f: $(wc -c < /tmp/$f) bytes"
  npx --yes esbuild /tmp/$f --bundle=false --outfile=/dev/null 2>/dev/null && echo "  sintaxă OK" || node --check /tmp/$f 2>/dev/null && echo "  sintaxă OK (node)" || echo "  ATENȚIE sintaxă"
done
echo "── pagini cheie ──"
for u in / /series /episode /login /register; do
  echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev$u)"
done
