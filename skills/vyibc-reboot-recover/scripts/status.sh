#!/usr/bin/env bash
set -euo pipefail

APP_PORT="${APP_PORT:-1007}"
VNC_URL="https://parseweb.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote"

echo "=== services ==="
systemctl --no-pager --full status adspower-global.service | sed -n '1,20p' || true
systemctl --no-pager --full status adspower-instance-autostart.timer | sed -n '1,20p' || true

echo
echo "=== ports ==="
ss -lntp | grep -E ':1006|:1007|:50325|:5900' || true

echo
echo "=== ads api ==="
curl -sS -m 5 http://127.0.0.1:50325/status || true
echo
for id in k1b908rw k1b8yqxe k1ba8vac; do
  echo "[${id}]"
  curl -sS -m 8 "http://127.0.0.1:50325/api/v1/browser/active?user_id=${id}" || true
  echo
  sleep 1
done

echo "=== urls ==="
local_app="$(curl -sS -m 5 "http://127.0.0.1:${APP_PORT}/image-generate" || true)"
public_app="$(curl -sS -m 8 "https://parses.vyibc.com/image-generate" || true)"
echo "[local app]"; echo "${local_app:0:80}"; echo
echo "[public app]"; echo "${public_app:0:80}"; echo
vnc_html="$(curl -sS -m 8 "${VNC_URL}" || true)"
echo "[public vnc]"; [[ "${vnc_html}" == *"noVNC"* ]] && echo "noVNC ok" || echo "noVNC check failed"
