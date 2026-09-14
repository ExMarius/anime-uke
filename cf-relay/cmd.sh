#!/usr/bin/env bash
set -uo pipefail
echo "── deploy + verificare optimizări Lighthouse ──"
./deploy.sh
echo "exit deploy: $?"
echo "── 1. skeleton anti-CLS în HTML servit ──"
curl -s https://anime-uke.pages.dev/ | grep -c "hban--loading\|sk-card"
echo "── 2. CSS minificat (mărimea servită) ──"
curl -s https://anime-uke.pages.dev/assets/css/style.css | wc -c
echo "── 3. HSTS header ──"
curl -sI https://anime-uke.pages.dev/ | grep -i strict-transport || echo "LIPSĂ"
echo "── 4. zero atribute style= (CSP-safe) ──"
curl -s https://anime-uke.pages.dev/ | grep -c 'style="' || true
echo "── 5. site funcțional ──"
echo "/ -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev/)"
echo "/serie/1014 -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev/serie/1014)"
