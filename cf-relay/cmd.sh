#!/usr/bin/env bash
set -uo pipefail
echo "── cover-urile reale din producție ──"
curl -s "https://anime-uke.pages.dev/api/series?per_page=3" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for s in (d.get('data',{}).get('series') or d.get('series') or [])[:3]:
    print(s.get('id'), s.get('title'), '->', s.get('cover_image'))
"
echo "── test weserv cu URL-ul externe (exact ca în cod) ──"
COVER=$(curl -s "https://anime-uke.pages.dev/api/series?per_page=1" | python3 -c "
import json,sys,urllib.parse
d=json.load(sys.stdin)
s=(d.get('data',{}).get('series') or [{}])[0]
c=s.get('cover_image') or ''
u=urllib.parse.urlparse(c)
print(urllib.parse.quote(u.netloc+u.path+u.query, safe=''))
")
echo "url param: $COVER"
curl -s -o /tmp/w.webp -w "weserv: %{http_code} %{content_type} %{size_download}B\n" "https://images.weserv.nl/?url=$COVER&w=1280&q=80&output=webp&fit=cover&a=top&we"
echo "── original direct ──"
ORIG=$(curl -s "https://anime-uke.pages.dev/api/series?per_page=1" | python3 -c "
import json,sys
d=json.load(sys.stdin)
s=(d.get('data',{}).get('series') or [{}])[0]
print(s.get('cover_image') or '')
")
curl -s -o /dev/null -w "original: %{http_code} %{content_type} %{size_download}B\n" "$ORIG"
