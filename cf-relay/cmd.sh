#!/usr/bin/env bash
set -uo pipefail
JS=$(curl -s "https://anime-uke.pages.dev/assets/js/page-profile.js")
CSS=$(curl -s "https://anime-uke.pages.dev/assets/css/page-user.css")
echo "js taburi (ptabs__btn): $(echo "$JS" | grep -o 'ptabs__btn' | wc -l)"
echo "js pane (.ptab): $(echo "$JS" | grep -o '\.ptab' | wc -l)"
echo "css taburi (.ptab{): $(echo "$CSS" | grep -o '\.ptab{' | wc -l)"
