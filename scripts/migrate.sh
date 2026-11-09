#!/bin/sh
# Chạy MỘT LẦN trong container bản cũ (Coolify) để gửi /app/data sang bản Vibe Host.
# Khoá nhập KHÔNG nằm ở đây: truyền qua đối số thứ nhất.  sh migrate.sh <IMPORT_TOKEN>
set -e
curl -fsSL https://raw.githubusercontent.com/marcommatbao/ads-manager-chinh/main/scripts/export-data-to.mjs -o /tmp/exp.mjs
IMPORT_URL=https://adscommand-chinh.vibe.tinhgon.xyz IMPORT_TOKEN="$1" DATA_DIR=/app/data node /tmp/exp.mjs
rm -f /tmp/exp.mjs
