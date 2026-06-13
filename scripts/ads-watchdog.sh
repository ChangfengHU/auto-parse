#!/bin/bash
# AdsPower instance watchdog — uses local-active (real process list) to detect dead instances.
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

# 用 local-active 枚举真实在跑的进程（不信任 browser/active 单实例接口，它有状态缓存）
ACTIVE_IDS=$(curl -s --max-time 8 "${ADS_API}/api/v1/browser/local-active" 2>/dev/null | \
  python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    ids = [x['user_id'] for x in d.get('data', {}).get('list', [])]
    print(','.join(ids))
except:
    print('')
" 2>/dev/null)

IFS=',' read -ra INSTANCES <<< "$ADS_INSTANCE_POOL_IDS"

for ID in "${INSTANCES[@]}"; do
  ID=$(echo "$ID" | tr -d ' ')
  [ -z "$ID" ] && continue

  # 检查该 ID 是否在真实活跃列表里
  if echo ",$ACTIVE_IDS," | grep -q ",${ID},"; then
    : # 真实活跃，不动
  else
    echo "[ads-watchdog] $(date -u +%FT%TZ) instance ${ID} not in local-active, stop+start"
    # 先 stop 清除 AdsPower 残留的 startup 文件（否则 start 会因为以为"已启动"而不拉起新进程）
    curl -s --max-time 8 "${ADS_API}/api/v1/browser/stop?user_id=${ID}" > /dev/null 2>&1
    sleep 1
    START=$(curl -s --max-time 15 "${ADS_API}/api/v1/browser/start?user_id=${ID}" 2>/dev/null)
    START_CODE=$(echo "$START" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('code','-1'))" 2>/dev/null)
    echo "[ads-watchdog] browser/start for ${ID}: code=${START_CODE}"
  fi
done
