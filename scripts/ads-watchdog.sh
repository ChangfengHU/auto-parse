#!/bin/bash
# AdsPower instance watchdog — checks all pool instances and calls browser/start for inactive ones.
# Run via systemd timer every 30 seconds.

ADS_API="${ADS_API_URL:-http://127.0.0.1:50325}"
ENV_FILE="/home/a01020323900/code/auto-parse/.env.local"

# Load ADS_INSTANCE_POOL_IDS from .env.local if not in environment
if [ -z "$ADS_INSTANCE_POOL_IDS" ] && [ -f "$ENV_FILE" ]; then
  ADS_INSTANCE_POOL_IDS=$(grep -E '^ADS_INSTANCE_POOL_IDS=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d ' ')
fi

if [ -z "$ADS_INSTANCE_POOL_IDS" ]; then
  echo "[ads-watchdog] ADS_INSTANCE_POOL_IDS not set, skipping"
  exit 0
fi

IFS=',' read -ra INSTANCES <<< "$ADS_INSTANCE_POOL_IDS"

for ID in "${INSTANCES[@]}"; do
  ID=$(echo "$ID" | tr -d ' ')
  [ -z "$ID" ] && continue

  STATUS=$(curl -s --max-time 5 "${ADS_API}/api/v1/browser/active?user_id=${ID}" 2>/dev/null)
  CODE=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('code','-1'))" 2>/dev/null)

  if [ "$CODE" = "0" ]; then
    # Active — no action needed
    :
  else
    echo "[ads-watchdog] $(date -u +%FT%TZ) instance ${ID} inactive (code=${CODE}), attempting browser/start"
    START=$(curl -s --max-time 10 "${ADS_API}/api/v1/browser/start?user_id=${ID}" 2>/dev/null)
    START_CODE=$(echo "$START" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('code','-1'))" 2>/dev/null)
    echo "[ads-watchdog] browser/start response for ${ID}: code=${START_CODE}"
  fi
done
