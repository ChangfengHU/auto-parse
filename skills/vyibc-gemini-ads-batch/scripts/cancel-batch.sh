#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${1:-}"
BASE_URL="${VYIBC_BASE_URL:-https://parse.vyibc.com}"

if [[ -z "$TASK_ID" ]]; then
  echo "[ERROR] 用法: bash scripts/cancel-batch.sh '<taskId>'"
  exit 1
fi

API="${BASE_URL}/api/gemini-web/image/ads-batch/tasks/${TASK_ID}/cancel"
RES=$(curl -sS -X POST "$API")

python3 - "$RES" <<'PYEOF'
import json, sys
try:
    d = json.loads(sys.argv[1])
except Exception:
    print("[ERROR] 取消响应不是合法 JSON")
    raise SystemExit(1)

if d.get("error"):
    print(f"[ERROR] {d['error']}")
    raise SystemExit(1)

print(f"[TASK_ID] {d.get('taskId','')}")
print(f"[STATUS] {d.get('status','unknown')}")
print(f"[CANCEL_REQUESTED] {str(bool(d.get('cancelRequested'))).lower()}")
print("[DONE] 已发送取消请求")
PYEOF

