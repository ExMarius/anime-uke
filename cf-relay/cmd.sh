#!/usr/bin/env bash
set -uo pipefail
D="https://7256ba3c.anime-uke.pages.dev"
echo "── direct pe deployment-ul 7256ba3c (fără cache) ──"
echo "/ -> $(curl -s -o /dev/null -w '%{http_code}' $D/)"
echo "/serie/1014 -> $(curl -s -o /dev/null -w '%{http_code}' $D/serie/1014)"
echo "── sitemap pe deployment ──"
curl -s "$D/sitemap.xml" | head -8
echo "── meta pe /episode (deployment) ──"
curl -s "$D/episode" | grep -c 'google-site-verification'
