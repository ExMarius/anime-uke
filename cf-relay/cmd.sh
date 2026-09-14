#!/usr/bin/env bash
set -uo pipefail
echo "── UNDE trimite /? ──"
curl -sI https://anime-uke.pages.dev/ | grep -iE "^HTTP|^location"
echo "── UNDE trimite /series? ──"
curl -sI https://anime-uke.pages.dev/series | grep -iE "^HTTP|^location"
echo "── meta GSC mai e pe prima pagina? ──"
curl -s https://anime-uke.pages.dev/ | grep -o 'google-site-verification' | head -1 || echo "META GSC LIPSĂ!"
echo "── meta GSC pe /login? ──"
curl -s https://anime-uke.pages.dev/login | grep -o 'google-site-verification' | head -1 || echo "LIPSĂ pe /login"
echo "── titlul paginii / ──"
curl -sL https://anime-uke.pages.dev/ | grep -o "<title>[^<]*</title>" | head -1
