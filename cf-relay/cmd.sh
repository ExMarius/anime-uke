#!/usr/bin/env bash
# READ-ONLY: jurnalul admin recent (s-au șters serii la ~18:35?) + counturi D1.
set -uo pipefail
WRANGLER="npx wrangler"
[ -x "$PWD/node_modules/.bin/wrangler" ] && WRANGLER="$PWD/node_modules/.bin/wrangler"
echo "=== admin_log ultimele 12 ==="
$WRANGLER d1 execute DB --remote --json --command "SELECT id, admin_id, action, target_type, target_id, created_at FROM admin_log ORDER BY id DESC LIMIT 12" 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
rows=d[0]['results'] if isinstance(d,list) else d.get('results',[])
for r in rows: print(r['id'], r['created_at'], 'admin#'+str(r['admin_id']), r['action'], r.get('target_type'), r.get('target_id'))
"
echo
echo "=== counturi ==="
$WRANGLER d1 execute DB --remote --json --command "SELECT (SELECT COUNT(*) FROM anime_series) serii, (SELECT COUNT(*) FROM episodes) episoade, (SELECT COUNT(*) FROM users) useri, (SELECT COUNT(*) FROM chat_messages) chat" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['results'][0])"
echo
echo "=== sitemap acum (count) ==="
curl -s "https://anime-uke.pages.dev/sitemap.xml" | grep -oE '<loc>[^<]*</loc>' | wc -l
