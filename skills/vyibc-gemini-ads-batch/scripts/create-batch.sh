#!/usr/bin/env bash
set -euo pipefail

RUNS_JSON="${1:-}"
WORKFLOW_ID="${2:-}"
MAX_CONCURRENCY="${3:-}"
BASE_URL="${VYIBC_BASE_URL:-https://parse.vyibc.com}"
API="${BASE_URL}/api/gemini-web/image/ads-batch"

if [[ -z "$RUNS_JSON" ]]; then
  echo "[ERROR] 用法: bash scripts/create-batch.sh '<runs-json>' '<workflowId可选>' '<maxConcurrency可选>'"
  exit 1
fi

BODY=$(python3 - "$RUNS_JSON" "$WORKFLOW_ID" "$MAX_CONCURRENCY" <<'PYEOF'
import json, sys
runs_raw = sys.argv[1]
try:
    runs = json.loads(runs_raw)
except Exception:
    print(json.dumps({"__error__": "runs 不是合法 JSON"}))
    raise SystemExit(0)

if not isinstance(runs, list):
    print(json.dumps({"__error__": "runs 必须是数组"}))
    raise SystemExit(0)

payload = {"runs": runs}
if sys.argv[2]:
    payload["workflowId"] = sys.argv[2]
if sys.argv[3]:
    try:
        payload["maxConcurrency"] = int(sys.argv[3])
    except Exception:
        pass
print(json.dumps(payload, ensure_ascii=False))
PYEOF
)

ERR_MSG=$(python3 - "$BODY" <<'PYEOF'
import json, sys
try:
    d = json.loads(sys.argv[1])
    print(d.get("__error__", ""))
except Exception:
    print("")
PYEOF
)
if [[ -n "$ERR_MSG" ]]; then
  echo "[ERROR] $ERR_MSG"
  exit 1
fi

RES=$(curl -sS -X POST "$API" \
  -H "Content-Type: application/json" \
  -d "$BODY")

TASK_ID=$(python3 - "$RES" <<'PYEOF'
import json, sys
try:
    d = json.loads(sys.argv[1])
    print(d.get("taskId", ""))
except Exception:
    print("")
PYEOF
)

if [[ -z "$TASK_ID" ]]; then
  MSG=$(python3 - "$RES" <<'PYEOF'
import json, sys
try:
    d = json.loads(sys.argv[1])
    print(d.get("error", "创建批量任务失败"))
except Exception:
    print("创建批量任务失败")
PYEOF
)
  echo "[ERROR] $MSG"
  exit 1
fi

echo "[TASK_ID] $TASK_ID"
python3 - "$RES" <<'PYEOF'
import json, sys
d = json.loads(sys.argv[1])
s = d.get("summary") or {}
print(f"[STATUS] {d.get('status','queued')}")
print(f"[SUMMARY] total={s.get('total',0)} success={s.get('success',0)} failed={s.get('failed',0)} running={s.get('running',0)} queued={s.get('queued',0)} cancelled={s.get('cancelled',0)}")
if d.get("queryUrl"):
    print(f"[QUERY_API] {d['queryUrl']}")
PYEOF

