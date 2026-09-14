#!/usr/bin/env bash
set -uo pipefail
echo "── deploy final ──"
./deploy.sh
echo "exit deploy: $?"
echo "── WebP negociat (Accept: image/webp) ──"
curl -s -o /dev/null -w "jpg cerut, tip servit: %{content_type}, %{size_download}B\n" \
  -H "Accept: image/webp" "https://anime-uke.pages.dev/covers/one-piece.jpg"
curl -s -o /dev/null -w "fără webp:            %{content_type}, %{size_download}B\n" \
  -H "Accept: image/jpeg" "https://anime-uke.pages.dev/covers/one-piece.jpg"
echo "── hero inline + preload în HTML ──"
curl -s "https://anime-uke.pages.dev/?cb=$RANDOM" | grep -c 'id="hero-bg-img"\|rel="preload"'
echo "── un singur script JS pe index ──"
curl -s "https://anime-uke.pages.dev/?cb=$RANDOM" | grep -o 'script type="module" src="[^"]*"' | wc -l
echo "── cache pe imagini ──"
curl -sI -H "Accept: image/webp" "https://anime-uke.pages.dev/covers/one-piece.jpg" | grep -i cache-control
echo "── pagini ──"
for u in / /series /episode /login /register; do
  echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev$u)"
done
