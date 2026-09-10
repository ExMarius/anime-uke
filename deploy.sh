#!/usr/bin/env bash
# Deploy complet AnimeSphere pe Cloudflare — proiect anime-uke, DB nou.
# Ruleaza: bash deploy.sh
set -euo pipefail

PROJECT="anime-uke"
DB_NAME="anime-db"

echo "==> 1/5 Verific autentificarea wrangler"
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login

echo "==> 2/5 Creez baza de date D1"
if grep -q '__INLOCUIESTE_DUPA_CREARE__' wrangler.toml; then
  UUID=$(npx wrangler d1 create "$DB_NAME" --json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const r=Array.isArray(j)?j:j.results;console.log(r[0].uuid)})')
  sed -i.bak "s/__INLOCUIESTE_DUPA_CREARE__/$UUID/" wrangler.toml && rm -f wrangler.toml.bak
  echo "    database_id = $UUID"
else
  echo "    deja configurat, sar peste"
fi

echo "==> 3/5 Aplic schema pe D1 (remote)"
npx wrangler d1 migrations apply DB --remote

echo "==> 4/5 Setez JWT_SECRET (generat aleator, nu e afisat)"
openssl rand -hex 32 | npx wrangler pages secret put JWT_SECRET --project-name="$PROJECT"

echo "==> 5/5 Deploy pe Pages"
npx wrangler pages deploy --project-name="$PROJECT"

echo
echo "Gata. Site: https://$PROJECT.pages.dev"
echo "Primul cont inregistrat devine automat admin."
