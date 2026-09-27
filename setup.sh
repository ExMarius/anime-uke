#!/usr/bin/env bash
# =====================================================================
# setup.sh — pregateste TOT pentru o sesiune/agent nou, dintr-o comanda.
#   ./setup.sh          → node >=22, dependente, permisiuni
#   ./setup.sh test     → aceeasi chestie + ruleaza ./test.sh la final
# Idempotent: se poate rula de cate ori e nevoie.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

if [ "$(node_major)" -lt 22 ]; then
  if [ -x "$HOME/.cache/node24/bin/node" ]; then
    export PATH="$HOME/.cache/node24/bin:$PATH"
  else
    echo "── instalez Node 24 in ~/.cache/node24 (suitele cer node:sqlite) ──"
    V=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/ | grep -oE 'node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz' | head -1)
    mkdir -p "$HOME/.cache/node24"
    curl -fsSL "https://nodejs.org/dist/latest-v24.x/$V" -o /tmp/n24.tar.xz
    tar -xJf /tmp/n24.tar.xz -C "$HOME/.cache/node24" --strip-components=1
    rm -f /tmp/n24.tar.xz
    export PATH="$HOME/.cache/node24/bin:$PATH"
  fi
fi
echo "node: $(node -v)"

chmod +x *.sh 2>/dev/null || true
[ -f cmd.sh ] && chmod +x cmd.sh 2>/dev/null || true

if [ ! -d node_modules ]; then
  echo "── npm install ──"
  npm install --no-audit --no-fund
fi

echo "── SETUP GATA ──"
echo "Daca intr-un shell nou node -v < 22: export PATH=\$HOME/.cache/node24/bin:\$PATH"
if [ "${1:-}" = "test" ]; then
  ./test.sh
fi
