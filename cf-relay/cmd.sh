#!/usr/bin/env bash
set -uo pipefail
ACC="80024736ee1b2c8800e84d668dc57154"
API="https://api.cloudflare.com/client/v4"

echo "── proiectul Pages: sursă/branch ──"
curl -s "$API/accounts/$ACC/pages/projects/anime-uke" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | python3 -c "
import json,sys
p=json.load(sys.stdin)['result']
print('production_branch:', p.get('production_branch'))
src=p.get('source') or {}
print('source tip:', src.get('type'))
if src.get('type')=='github':
    print('repo:', src.get('config',{}).get('owner')+'/'+src.get('config',{}).get('repo_name'))
    print('branch productie:', src.get('config',{}).get('production_branch'))
print('domenii:', p.get('domains'))
"

echo "── ultimele 8 deployment-uri ──"
curl -s "$API/accounts/$ACC/pages/projects/anime-uke/deployments?per_page=8" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | python3 -c "
import json,sys
for d in json.load(sys.stdin)['result']:
    src=(d.get('deployment_trigger') or {}).get('metadata') or {}
    print(d['created_on'][:16], '|', d.get('environment'), '|',
          src.get('commit_message','(fara commit)')[:40], '|', d['id'][:12])
"

echo "── site acum (URL curate) ──"
for u in / /series /serie/1014 /sitemap.xml; do
  echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' https://anime-uke.pages.dev$u)"
done
