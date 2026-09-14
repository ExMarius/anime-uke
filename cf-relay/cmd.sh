#!/usr/bin/env bash
set -uo pipefail
U='m.media-amazon.com%2Fimages%2FM%2FMV5BMTNjNGU4NTUtYmVjMy00YjRiLTkxMWUtNzZkMDNiYjZhNmViXkEyXkFqcGc%40._V1_FMjpg_UX1000_.jpg'
echo "── weserv cu URL-ul REAL al seriei ──"
curl -s -o /tmp/w.webp -w "status=%{http_code} tip=%{content_type} bytes=%{size_download}\n" \
  "https://images.weserv.nl/?url=$U&w=1280&q=80&output=webp&fit=cover&a=top&we"
echo "── weserv 400w (telefon) ──"
curl -s -o /tmp/w400.webp -w "status=%{http_code} tip=%{content_type} bytes=%{size_download}\n" \
  "https://images.weserv.nl/?url=$U&w=400&q=80&output=webp&fit=cover&a=top&we"
file /tmp/w.webp /tmp/w400.webp 2>/dev/null | head -2
echo "── original direct (amazon) ──"
curl -s -o /tmp/o.jpg -w "status=%{http_code} tip=%{content_type} bytes=%{size_download}\n" \
  "https://m.media-amazon.com/images/M/MV5BMTNjNGU4NTUtYmVjMy00YjRiLTkxMWUtNzZkMDNiYjZhNmViXkEyXkFqcGc@._V1_FMjpg_UX1000_.jpg"
