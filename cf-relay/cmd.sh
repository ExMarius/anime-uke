#!/usr/bin/env bash
set -uo pipefail
echo "── variante IMDb native ──"
for W in 400 800 1280; do
  curl -s -o /tmp/ux$W.jpg -w "UX${W}: %{http_code} %{content_type} %{size_download}B\n" \
    "https://m.media-amazon.com/images/M/MV5BMTNjNGU4NTUtYmVjMy00YjRiLTkxMWUtNzZkMDNiYjZhNmViXkEyXkFqcGc@._V1_FMjpg_UX${W}_.jpg"
done
