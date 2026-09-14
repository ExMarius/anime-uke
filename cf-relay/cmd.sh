#!/usr/bin/env bash
set -uo pipefail
echo "── deploy ──"
./deploy.sh
echo "exit deploy: $?"
echo "── WebP negociat ──"
curl -s -o /dev/null -w "cu Accept webp: %{content_type} %{size_download}B\n" -H "Accept: image/webp" "https://anime-uke.pages.dev/covers/one-piece.jpg?v=$RANDOM"
echo "── hero inline + preload ──"
curl -s "https://anime-uke.pages.dev/?cb=$RANDOM" | grep -o 'id="hero-bg-img"' | head -1
curl -s "https://anime-uke.pages.dev/?cb=$RANDOM" | grep -o 'rel="preload" as="image"' | head -1
echo "── scripturi JS pe index ──"
curl -s "https://anime-uke.pages.dev/?cb=$RANDOM" | grep -o 'script type="module" src="[^"]*"' | wc -l
echo "── pagini ──"
for u in / /series /episode; do echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev$u)"; done
