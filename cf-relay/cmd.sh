#!/usr/bin/env bash
set -uo pipefail
echo "hero-1.webp direct: $(curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}B' "https://anime-uke.pages.dev/assets/img/hero-1.webp?cb=$RANDOM")"
echo "one-piece.webp direct: $(curl -s -o /dev/null -w '%{http_code} %{content_type}' "https://anime-uke.pages.dev/covers/one-piece.webp?cb=$RANDOM")"
echo "hero-1.jpg cu Accept webp: $(curl -s -o /dev/null -w '%{http_code} %{content_type}' -H "Accept: image/webp" "https://anime-uke.pages.dev/assets/img/hero-1.jpg?cb=$RANDOM")"
echo "hero-2.jpg cu Accept webp: $(curl -s -o /dev/null -w '%{http_code} %{content_type}' -H "Accept: image/webp" "https://anime-uke.pages.dev/assets/img/hero-2.jpg?cb=$RANDOM")"
