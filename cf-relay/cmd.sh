#!/usr/bin/env bash
set -uo pipefail
B=https://anime-uke.pages.dev
echo -n "data-ad-slot pe /serie/1014: "; curl -s "$B/serie/1014" | grep -c "data-ad-slot"
echo -n "data-ad-slot pe episode.html (shell): "; curl -s "$B/episode?id=1" | grep -c "data-ad-slot" || true
echo -n "gratuit in footer /serie/1014: "; curl -s "$B/serie/1014" | grep -o "anime subtitrat în română, gratuit." | head -1
