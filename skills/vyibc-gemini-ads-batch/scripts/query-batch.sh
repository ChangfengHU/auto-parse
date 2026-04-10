#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${1:-}"
BASE_URL="${VYIBC_BASE_URL:-https://parse.vyibc.com}"

if [[ -z "$TASK_ID" ]]; then
  echo "[ERROR] 用法: bash scripts/query-batch.sh '<taskId>'"
  exit 1
fi

API="${BASE_URL}/api/gemini-web/image/ads-batch/tasks/${TASK_ID}"
RES=$(curl -sS "$API")

python3 - "$RES" <<'PYEOF'
import json, sys

try:
    d = json.loads(sys.argv[1])
except Exception:
    print("[ERROR] 查询结果不是合法 JSON")
    raise SystemExit(1)

if d.get("error"):
    print(f"[ERROR] {d['error']}")
    raise SystemExit(1)

status = d.get("status", "unknown")
done = bool(d.get("done"))
ready = bool(d.get("resultReady"))
summary = d.get("summary") or {}
result = d.get("result") or {}
runs = result.get("runs") or []

print(f"[STATUS] {status}")
print(f"[DONE_FLAG] {str(done).lower()}")
print(f"[RESULT_READY] {str(ready).lower()}")
print(
    f"[SUMMARY] total={summary.get('total',0)} success={summary.get('success',0)} "
    f"failed={summary.get('failed',0)} running={summary.get('running',0)} "
    f"queued={summary.get('queued',0)} cancelled={summary.get('cancelled',0)}"
)

for run in runs:
    print(
        f"[RUN] #{run.get('index',-1)+1} {run.get('browserInstanceId','')} "
        f"{run.get('status','unknown')} {run.get('prompt','')}"
    )
    if run.get("primaryImageUrl"):
        print(f"[IMAGE_URL] {run['primaryImageUrl']}")
    if run.get("error"):
        print(f"[RUN_ERROR] #{run.get('index',-1)+1} {run.get('error')}")

all_urls = result.get("imageUrls") or []
if done:
    if status == "success":
        print(f"[DONE] 批量任务完成，共 {len(all_urls)} 张图片")
    elif status == "cancelled":
        print("[ERROR] 任务已取消")
    else:
        print("[ERROR] 任务已结束但未成功，请查看 RUN_ERROR")
PYEOF

