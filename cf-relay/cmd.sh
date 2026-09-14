#!/usr/bin/env bash
set -uo pipefail
echo "── deploy optimizări CLS + llms.txt ──"
./deploy.sh
echo "exit deploy: $?"
echo "── llms.txt live ──"
curl -s -o /tmp/l.txt -w "status=%{http_code} tip=%{content_type}\n" https://anime-uke.pages.dev/llms.txt
head -3 /tmp/l.txt
echo "── ordine secțiuni în HTML servit (serii înainte de tops) ──"
curl -s https://anime-uke.pages.dev/ | grep -o 'id="serii"\|id="tops-section"\|id="recent-section"' | head -3
