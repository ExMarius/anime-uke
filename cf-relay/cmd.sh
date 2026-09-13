#!/usr/bin/env bash
set -uo pipefail
echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"
echo "sanitate: / -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev/)"
