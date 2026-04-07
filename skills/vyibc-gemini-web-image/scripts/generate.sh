#!/usr/bin/env bash
set -euo pipefail

PROMPT="${1:-}"
WORKFLOW_ID="${2:-}"
KEEP_TAB_OPEN="${3:-false}"
BASE_URL="${VYIBC_BASE_URL:-https://parse.vyibc.com}"
GENERATE_API="${BASE_URL}/api/gemini-web/image/generate"

if [[ -z "$PROMPT" ]]; then
  echo "[ERROR] 用法: bash scripts/generate.sh \"<prompt>\" \"<workflowId可选>\" \"<keepTabOpen:true|false可选>\""
  exit 1
fi

BODY=$(python3 - "$PROMPT" "$WORKFLOW_ID" "$KEEP_TAB_OPEN" <<'PYEOF'
import json, sys
payload = {"prompt": sys.argv[1]}
if sys.argv[2]:
    payload["workflowId"] = sys.argv[2]
keep = (sys.argv[3] or "false").strip().lower()
payload["keepTabOpen"] = keep in ("1", "true", "yes", "y", "on")
print(json.dumps(payload, ensure_ascii=False))
PYEOF
)

CREATE_RES=$(curl -s -X POST "$GENERATE_API" \
  -H "Content-Type: application/json" \
  -d "$BODY")

TASK_ID=$(python3 - "$CREATE_RES" <<'PYEOF'
import json, sys
try:
    d = json.loads(sys.argv[1])
    print(d.get("taskId", ""))
except Exception:
    print("")
PYEOF
)

if [[ -z "$TASK_ID" ]]; then
  ERR_MSG=$(python3 - "$CREATE_RES" <<'PYEOF'
import json, sys
try:
    d = json.loads(sys.argv[1])
    print(d.get("error", "创建任务失败"))
except Exception:
    print("创建任务失败")
PYEOF
)
  echo "[ERROR] ${ERR_MSG}"
  exit 1
fi

STATUS_API="${BASE_URL}/api/gemini-web/image/tasks/${TASK_ID}"
echo "[TASK_ID] ${TASK_ID}"

SEEN=""
while true; do
  STATUS_RES=$(curl -s "$STATUS_API")
  OUT=$(python3 - "$STATUS_RES" "$SEEN" <<'PYEOF'
import json, sys

def key(cp):
    return f"{cp.get('stepIndex','x')}|{cp.get('name','')}|{cp.get('status','')}|{cp.get('message','')}"

data = json.loads(sys.argv[1])
seen = set(filter(None, sys.argv[2].split("|||")))
new_seen = set(seen)

for cp in data.get("checkpoints", []):
    k = key(cp)
    if k not in seen:
        print(f"[PROGRESS] {cp.get('name','step')}:{cp.get('status','running')}:{cp.get('message','')}")
    new_seen.add(k)

print(f"[SEEN] {'|||'.join(sorted(new_seen))}")
print(f"[STATUS] {data.get('status','unknown')}")
if data.get("status") == "success":
    result = data.get("result") or {}
    urls = result.get("imageUrls") or []
    for url in urls:
        print(f"[IMAGE_URL] {url}")
    print(f"[DONE] 生成完成，共 {len(urls)} 张图片")
elif data.get("status") == "failed":
    print(f"[ERROR] {data.get('error') or '任务失败'}")
elif data.get("status") == "cancelled":
    print("[ERROR] 任务已取消")
PYEOF
)

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    if [[ "$line" == "[SEEN]"* ]]; then
      SEEN="${line#\[SEEN\] }"
    elif [[ "$line" == "[STATUS]"* ]]; then
      STATUS="${line#\[STATUS\] }"
    else
      echo "$line"
    fi
  done <<< "$OUT"

  if [[ "${STATUS:-}" == "success" ]]; then
    exit 0
  fi
  if [[ "${STATUS:-}" == "failed" || "${STATUS:-}" == "cancelled" ]]; then
    exit 1
  fi
  sleep 5
done
