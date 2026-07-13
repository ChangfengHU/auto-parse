#!/bin/bash
set -euo pipefail

for unit in auto-parse-65.service auto-parse.service; do
  if systemctl cat "$unit" >/dev/null 2>&1; then
    echo "Restarting $unit through systemd..."
    systemctl restart "$unit"
    systemctl --no-pager --full status "$unit"
    exit 0
  fi
done

if lsof -t -i:1007 >/dev/null 2>&1; then
  echo "Port 1007 is already in use; refusing to start a second auto-parse process." >&2
  exit 1
fi

echo "No systemd unit found; starting a foreground development server."
exec npm run dev
