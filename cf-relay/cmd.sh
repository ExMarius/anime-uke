#!/usr/bin/env bash
# Probe: variante ale ACEEASI animatii (baza rtMO2T0cQrE) + marker ANIM pt webp.
set -uo pipefail
BASE="https://media.tenor.com/rtMO2T0cQrE"
for SUF in AAAAC AAAAG AAAAM AAAAU AAAA1 AAAPo; do
  for EXT in gif webp mp4; do
    U="${BASE}${SUF}/42.${EXT}"
    R=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' -I "$U")
    echo "$R  <-  $U"
  done
done
echo "── webp AAAA1 e animat? (cautam chunk ANIM) ──"
curl -s "${BASE}AAAA1/42.webp" -o /tmp/t.webp 2>/dev/null && ls -la /tmp/t.webp && grep -c ANIM /tmp/t.webp || echo "0 (fara ANIM = static)"
echo "── totusi: ce zice un GET pe m/ fara nume? ──"
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' -I "https://media1.tenor.com/m/rtMO2T0cQrEAAAAC.gif"
