#!/usr/bin/env bash
set -uo pipefail
echo "── deploy consolă curată ──"
./deploy.sh
echo "exit deploy: $?"
echo "── Permissions-Policy live ──"
curl -sI https://anime-uke.pages.dev/ | grep -i "permissions-policy" || echo "LIPSĂ"
echo "── episode: fără allowfullscreen legacy ──"
curl -s https://anime-uke.pages.dev/episode | grep -c "allowfullscreen" || true
