#!/usr/bin/env bash
set -uo pipefail
echo "core.js cu optimizeCover: $(curl -s "https://anime-uke.pages.dev/assets/js/core.js?cb=$RANDOM" | grep -c weserv)"
echo "page-index cu weserv:     $(curl -s "https://anime-uke.pages.dev/assets/js/page-index.js?cb=$RANDOM" | grep -c weserv)"
echo "hero pe deployment nou (459cf7da): $(curl -s https://459cf7da.anime-uke.pages.dev/ | grep -c modulepreload)"
