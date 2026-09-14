#!/usr/bin/env bash
set -uo pipefail
echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"
echo "── WebP negociat ──"
curl -s -o /dev/null -w "cerere .jpg → servit: %{content_type} %{size_download}B\n" -H "Accept: image/webp" "https://anime-uke.pages.dev/covers/one-piece.jpg?cb=$RANDOM"
curl -s -o /dev/null -w "hero-1.jpg → servit:  %{content_type} %{size_download}B\n" -H "Accept: image/webp" "https://anime-uke.pages.dev/assets/img/hero-1.jpg?cb=$RANDOM"
echo "── fără webp (fallback jpeg) ──"
curl -s -o /dev/null -w "Accept jpeg: %{content_type} %{size_download}B\n" -H "Accept: image/jpeg" "https://anime-uke.pages.dev/covers/one-piece.jpg?cb=$RANDOM"
