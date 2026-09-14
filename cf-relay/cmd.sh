#!/usr/bin/env bash
set -uo pipefail
JS=$(curl -s "https://anime-uke.pages.dev/assets/js/page-admin-serie.js?cb=$RANDOM")
echo "next_number în bundle: $(echo "$JS" | grep -o "next_number" | wc -l)"
echo "MAX+1 flux (toast cu ✓): $(echo "$JS" | grep -o "a fost adăugat ✓" | wc -l)"
