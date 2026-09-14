#!/usr/bin/env bash
# Rulare relay fără deploy: audit read-only al sitului live + cote D1.
set -uo pipefail

echo "=== AUDIT LIVE (read-only, fără deploy) ==="
node scripts/audit-live.mjs https://anime-uke.pages.dev
echo "exit audit: $?"

echo
echo "=== cote D1 (buget 0: 100k scrieri/zi, 500 MB stocare, 5 GB citire/zi) ==="
npx wrangler d1 execute DB --remote --json \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'" 2>/dev/null \
| node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",async()=>{
  let tables=[];
  try{ tables=(JSON.parse(d)[0]?.results||[]).map(r=>r.name); }catch{ }
  if(!tables.length){ console.log("  (nu am putut lista tabelele)"); return; }
  for(const t of tables.sort()){
    let c="?";
    try{
      const out=require("child_process").execFileSync("npx",["wrangler","d1","execute","DB","--remote","--json","--command",`SELECT COUNT(*) c FROM "${t}"`],{encoding:"utf8"});
      c=JSON.parse(out)[0]?.results?.[0]?.c ?? "?";
    }catch(e){ c="eroare: "+(e.message||"").slice(0,60); }
    console.log(`  ${t}: ${c} rânduri`);
  }
});'
echo
echo "=== migrări remote ==="
npx wrangler d1 migrations list DB --remote 2>&1 | tail -8
