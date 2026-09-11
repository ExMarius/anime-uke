#!/usr/bin/env bash
# =====================================================================
# push.sh — impinge pe GitHub fara sa stocheze token-ul in .git/config.
#
# De ce un script si nu un remote configurat normal: fisierul .git/config
# NU persista intre sesiuni de lucru, deci un remote cu token embedded ar
# disparea oricum. Token-ul sta in /home/user/.secrets/gh-token, in afara
# repo-ului, iar scriptul il citeste la fiecare rulare.
#
# Autentificarea se face prin header HTTP, nu prin URL, ca sa nu apara
# token-ul in mesajele de eroare git sau in loguri.
#
#   ./push.sh              impinge branch-ul curent
#   ./push.sh --all        impinge toate branch-urile
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

SECRETS="${SECRETS_DIR:-/home/user/.secrets}"
TOKEN_FILE="$SECRETS/gh-token"

[ -f "$TOKEN_FILE" ] || { echo "✗ Lipseste $TOKEN_FILE" >&2; exit 1; }
TOKEN="$(tr -d '\n\r' < "$TOKEN_FILE")"
[ -n "$TOKEN" ] || { echo "✗ Token gol in $TOKEN_FILE" >&2; exit 1; }

# Identitatea se seteaza aici din acelasi motiv ca remote-ul: .git/config
# nu supravietuieste intre sesiuni.
git config user.name  "ExMarius"
git config user.email "exmarius@users.noreply.github.com"

REPO_URL="https://github.com/ExMarius/anime-uke.git"
[ -f "$SECRETS/repo-url" ] && REPO_URL="$(tr -d '\n\r' < "$SECRETS/repo-url")"

git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"

# GitHub accepta PAT ca parola in Basic auth; utilizatorul e irelevant.
AUTH="$(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "${1:-}" = "--all" ]; then
  echo "── imping toate branch-urile pe $REPO_URL ──"
  git -c http.extraHeader="Authorization: Basic $AUTH" push origin --all
else
  echo "── imping $BRANCH pe $REPO_URL ──"
  git -c http.extraHeader="Authorization: Basic $AUTH" push -u origin "$BRANCH"
fi
