#!/usr/bin/env bash
set -euo pipefail

TOKEN_FILE="${TOKEN_FILE:-/home/a01020323900/.secrets/cloudflared-vyibc-vnc-test-token}"
SERVICE_SRC="${SERVICE_SRC:-/home/a01020323900/code/auto-parse/ops/cloudflared-vnc.service.example}"
SERVICE_NAME="${SERVICE_NAME:-cloudflared-vyibc-vnc-test.service}"
SERVICE_DST="${SERVICE_DST:-/etc/systemd/system/${SERVICE_NAME}}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed" >&2
  exit 1
fi

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "missing token file: $TOKEN_FILE" >&2
  exit 1
fi

mode="$(stat -c '%a' "$TOKEN_FILE")"
if [[ "$mode" != "600" && "$mode" != "400" ]]; then
  echo "token file permissions must be 600 or 400: $TOKEN_FILE mode=$mode" >&2
  exit 1
fi

token_size="$(wc -c < "$TOKEN_FILE" | tr -d '[:space:]')"
if [[ "$token_size" -lt 100 ]]; then
  echo "token file does not look like a Cloudflare Tunnel connector token: $TOKEN_FILE size=${token_size} bytes" >&2
  echo "create/copy the connector token from Cloudflare Zero Trust Tunnel, not a Cloudflare API key" >&2
  exit 1
fi

if LC_ALL=C grep -q '^cfk_' "$TOKEN_FILE"; then
  echo "token file contains a Cloudflare API key, not a Tunnel connector token: $TOKEN_FILE" >&2
  exit 1
fi

if ! curl -fsS -o /dev/null "http://127.0.0.1:1006/vnc.html"; then
  echo "local noVNC is not reachable on http://127.0.0.1:1006/vnc.html" >&2
  exit 1
fi

sudo install -m 0644 "$SERVICE_SRC" "$SERVICE_DST"
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"
sudo systemctl status "$SERVICE_NAME" --no-pager -l
