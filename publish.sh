#!/usr/bin/env bash
# =====================================================================
# publish.sh — publică în PRODUCȚIE codul branch-ului curent, fără merge.
#
# De ce există: sandbox-ul agentului nu are acces de rețea la
# api.cloudflare.com, iar proprietarul a interzis merge-ul în `main` cât
# timp o sesiune e deschisă. Singurul drum permis către
# https://anime-uke.pages.dev e relay-ul din GitHub Actions, declanșat
# EXPLICIT pe branch-ul de sesiune.
#
# Ce face, în ordine:
#   1. refuză să ruleze pe `main` (acolo publică auto-deploy.yml);
#   2. refuză un arbore murdar (altfel ai publica alt cod decât ai testat);
#   3. scrie o linie nouă în cf-relay/deploy-request.txt (motiv + commit);
#   4. comite și împinge NUMAI pe branch-ul curent;
#   5. așteaptă rularea relay-ului și îți arată verdictul + auditul live.
#
# Ce NU face niciodată: merge, close de PR, push în main, ștergere de branch.
# Garda permanentă: tests/no-merge-guard.mjs.
#
# Folosire:
#   ./publish.sh "ce publici"        # publică și așteaptă verdictul
#   ./publish.sh --no-wait "motiv"   # doar declanșează
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")"

ASTEAPTA=1
if [ "${1:-}" = "--no-wait" ]; then ASTEAPTA=0; shift; fi
MOTIV="${1:-publicare din branch-ul sesiunii}"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SHA="$(git rev-parse --short HEAD)"

if [ "$BRANCH" = "main" ]; then
  echo "✗ publish.sh nu publică din main. Producția din main se face prin auto-deploy.yml," >&2
  echo "  iar sesiunile Arena publică din branch-ul lor (regula proprietarului)." >&2
  exit 1
fi
if [ "$BRANCH" = "HEAD" ]; then
  echo "✗ ești pe un HEAD detașat; treci pe branch-ul sesiunii înainte de publicare." >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "✗ arborele are modificări necomise. Comite-le întâi: publici exact ce e în commit." >&2
  git status --short >&2
  exit 1
fi

STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s | %s | %s | %s\n' "$STAMP" "$BRANCH" "$SHA" "$MOTIV" >> cf-relay/deploy-request.txt
git add cf-relay/deploy-request.txt
git commit -q -m "publica: ${MOTIV} (${BRANCH}@${SHA})"
NOU="$(git rev-parse --short HEAD)"

echo "── împing ${BRANCH}@${NOU} (relay-ul publică exact acest commit) ──"
git push origin "$BRANCH" || { echo "✗ push respins" >&2; exit 1; }

if [ "$ASTEAPTA" -eq 0 ]; then
  echo "✓ cerere trimisă. Verdictul: gh run list --workflow=cloudflare-relay.yml --branch=$BRANCH"
  exit 0
fi

command -v gh >/dev/null 2>&1 || { echo "! gh lipsește — urmărește manual workflow-ul"; exit 0; }

echo "── aștept relay-ul (deploy + audit live durează ~5-8 minute) ──"
ID=""
for _ in $(seq 1 30); do
  sleep 10
  ID="$(gh run list --workflow=cloudflare-relay.yml --branch="$BRANCH" --limit 5 \
    --json databaseId,headSha,status --jq \
    "[.[] | select(.headSha | startswith(\"$NOU\"))] | .[0].databaseId" 2>/dev/null || true)"
  [ -n "${ID:-}" ] && [ "$ID" != "null" ] && break
done
if [ -z "${ID:-}" ] || [ "$ID" = "null" ]; then
  echo "! nu am găsit rularea relay pentru ${NOU}; verifică: gh run list --branch=$BRANCH"
  exit 0
fi
echo "   rulare #${ID}"

STARE=""
for _ in $(seq 1 120); do
  STARE="$(gh run view "$ID" --json status,conclusion --jq '.status + "/" + (.conclusion // "-")' 2>/dev/null || echo '?')"
  case "$STARE" in completed/*) break ;; esac
  sleep 15
done
echo "   stare finală: ${STARE}"

echo "── verdictul relay-ului (comentariu pe commit, tokenii redactați) ──"
gh api "repos/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/commits/$(git rev-parse HEAD)/comments" \
  --jq '.[-1].body' 2>/dev/null | head -60 || echo "(încă nu există comentariu)"

echo "── aduc înapoi cf-relay/last-output.txt (runner-ul îl comite pe branch) ──"
git pull --rebase --quiet origin "$BRANCH" 2>/dev/null || echo "  (pull ulterior necesar)"

case "$STARE" in
  completed/success) echo "✅ publicat în producție din ${BRANCH}@${NOU}" ;;
  *) echo "❌ relay-ul nu s-a încheiat cu succes (${STARE}) — vezi cf-relay/last-output.txt"; exit 1 ;;
esac
