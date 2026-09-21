#!/usr/bin/env bash
# Verificare READ-ONLY (fără deploy): lămurește 2 neconcordanțe din ultimul audit:
#  1) HTML-ul lui / de pe live are alt titlu și ?v=960fa7b (build necunoscut în git)
#  2) sitemap-ul a arătat 11 URL-uri în audit și 6 URL-uri un minut mai târziu
set -uo pipefail
B="https://anime-uke.pages.dev"
WRANGLER="npx wrangler"
[ -x "$PWD/node_modules/.bin/wrangler" ] && WRANGLER="$PWD/node_modules/.bin/wrangler"

echo "=== 1. headere / (cache?) ==="
curl -sI "$B/" | grep -iE '^(HTTP|cache-control|etag|cf-cache-status|age|cf-ray|content-length)' | tr -d '\r'
echo "  titlu /: $(curl -s "$B/" -o /tmp/home.html; grep -oE '<title>[^<]*</title>' /tmp/home.html | head -1)"
echo "  ?v= din /: $(grep -oE '\?v=[A-Za-z0-9._-]+' /tmp/home.html | sort -u | tr '\n' ' ')"
echo "  description /: $(grep -oE '<meta name="description"[^>]*>' /tmp/home.html | head -1 | cut -c1-200)"

echo
echo "=== 2. deployment-uri Pages (care e production?) ==="
$WRANGLER pages deployment list --project-name=anime-uke 2>&1 | head -25

echo
echo "=== 3. D1 ground truth ==="
$WRANGLER d1 execute DB --remote --command "SELECT COUNT(*) AS serii FROM anime_series" 2>&1 | head -12
$WRANGLER d1 execute DB --remote --command "SELECT id, title, status FROM anime_series ORDER BY id" 2>&1 | head -30
$WRANGLER d1 execute DB --remote --command "SELECT COUNT(*) AS episoade FROM episodes" 2>&1 | head -12

echo
echo "=== 4. sitemap ACUM ==="
curl -s "$B/sitemap.xml" | grep -oE '<loc>[^<]*</loc>' | tr '\n' ' '; echo
echo "  headere sitemap:"; curl -sI "$B/sitemap.xml" | grep -iE '^(HTTP|cache-control|cf-cache-status|age)' | tr -d '\r'

echo
echo "=== 5. episod + pulse ==="
curl -sI "$B/episod/4210" | grep -iE '^(HTTP|cache-control|cf-cache-status|age)' | tr -d '\r'
echo "  /api/pulse → $(curl -s "$B/api/pulse")"
echo "  /login ?v=: $(curl -s "$B/login" | grep -oE '\?v=[A-Za-z0-9._-]+' | sort -u | tr '\n' ' ')"
