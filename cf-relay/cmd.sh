#!/usr/bin/env bash
set -uo pipefail
JS=$(curl -s "https://anime-uke.pages.dev/assets/js/page-profile.js?cb=$RANDOM")
echo "se-premiaza: $(echo "$JS" | grep -o "se premiază" | wc -l)"
echo "gold-in-lb: $(echo "$JS" | grep -o "lb__gold" | wc -l)"
echo "săptămânii: $(echo "$JS" | grep -o "săptămânii" | wc -l)"
