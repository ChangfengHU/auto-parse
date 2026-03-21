#!/usr/bin/env bash
# scripts/publish.sh — 调用本地发布接口，实时输出日志 + 阶段进度，结束时打印 [TASK_ID] 和 [DONE]/[ERROR]
# 用法：bash scripts/publish.sh "<ossUrl>" "<title>" ["<description>"] ["tag1,tag2"]
#
# 输出格式（OpenClaw 解析用）：
#   每行日志原样打印
#   [QRCODE_FILE] /tmp/douyin-qr-xxx.png       ← 遇到二维码时
#   [TASK_ID] 2026-03-22T10-00-00-abc12        ← 任务ID（成功/失败都会有）
#   [PROGRESS] download:ok:视频下载完成         ← 阶段进度（name:status:message）
#   [DONE] 发布成功！视频已提交抖音审核         ← 成功
#   [ERROR] 发布失败: xxx                       ← 失败

set -euo pipefail

OSS_URL="${1:-}"
TITLE="${2:-}"
DESCRIPTION="${3:-}"
TAGS="${4:-}"
API="http://localhost:1007/api/publish"
STATUS_API="http://localhost:1007/api/publish/status"

if [[ -z "$OSS_URL" || -z "$TITLE" ]]; then
  echo "[ERROR] 用法: bash scripts/publish.sh \"<ossUrl>\" \"<title>\" [\"<description>\"] [\"tag1,tag2\"]"
  exit 1
fi

# 构造 JSON body
BODY=$(python3 -c "
import json, sys
d = {'videoUrl': sys.argv[1], 'title': sys.argv[2]}
if sys.argv[3]: d['description'] = sys.argv[3]
if sys.argv[4]: d['tags'] = [t.strip() for t in sys.argv[4].split(',') if t.strip()]
print(json.dumps(d))
" "$OSS_URL" "$TITLE" "$DESCRIPTION" "$TAGS")

TASK_ID=""
FINAL_STATUS=""
FINAL_MSG=""
POLL_PID=""

# 后台状态轮询函数：拿到 taskId 后每 8s 查一次 checkpoint，输出 [PROGRESS] 行
poll_progress() {
  local tid="$1"
  local prev_seen=""
  while true; do
    sleep 8
    result=$(curl -s "${STATUS_API}?taskId=${tid}" 2>/dev/null || echo "")
    if [[ -z "$result" ]]; then continue; fi
    # 提取 checkpoints 并输出新增的阶段
    python3 - "$result" "$prev_seen" <<'PYEOF'
import json, sys
try:
    data = json.loads(sys.argv[1])
    seen = set(sys.argv[2].split(',')) if sys.argv[2] else set()
    cps = data.get('checkpoints', [])
    new_seen = []
    for cp in cps:
        key = cp['name'] + ':' + cp['status']
        new_seen.append(key)
        if key not in seen:
            print(f"[PROGRESS] {cp['name']}:{cp['status']}:{cp.get('message','')}")
            if cp.get('screenshotUrl'):
                print(f"[SCREENSHOT] {cp['name']}:http://localhost:1007{cp['screenshotUrl']}")
    print(f"[SEEN] {','.join(new_seen)}", flush=True)
except Exception:
    pass
PYEOF
    # 更新 prev_seen（取最后一行 [SEEN]）
    prev_seen=$(curl -s "${STATUS_API}?taskId=${tid}" 2>/dev/null | python3 -c "
import json,sys
try:
    data=json.load(sys.stdin)
    cps=data.get('checkpoints',[])
    print(','.join(f\"{c['name']}:{c['status']}\" for c in cps))
except: pass
" 2>/dev/null || echo "$prev_seen")
  done
}

# 清理后台轮询
cleanup() {
  [[ -n "$POLL_PID" ]] && kill "$POLL_PID" 2>/dev/null || true
}
trap cleanup EXIT

# 读取 SSE 流，逐行解析
while IFS= read -r raw_line; do
  [[ "$raw_line" != data:* ]] && continue
  json="${raw_line#data: }"

  TYPE=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('type',''))" "$json" 2>/dev/null || echo "")
  PAYLOAD=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('payload',''))" "$json" 2>/dev/null || echo "")

  case "$TYPE" in
    taskId)
      TASK_ID="$PAYLOAD"
      echo "[TASK_ID] $TASK_ID"
      # 启动后台状态轮询
      poll_progress "$TASK_ID" &
      POLL_PID=$!
      ;;
    log)
      echo "$PAYLOAD"
      ;;
    qrcode)
      QR_FILE="/tmp/douyin-qr-$(date +%s).png"
      echo "$PAYLOAD" | sed 's|data:image/png;base64,||' | base64 -d > "$QR_FILE" 2>/dev/null || true
      echo "[QRCODE_FILE] $QR_FILE"
      ;;
    done)
      FINAL_STATUS="done"
      FINAL_MSG="$PAYLOAD"
      if [[ -z "$TASK_ID" ]]; then
        TASK_ID=$(echo "$PAYLOAD" | python3 -c "import sys,re; m=re.search(r'\[taskId:\s*([^\]]+)\]', sys.stdin.read()); print(m.group(1).strip() if m else '')" 2>/dev/null || echo "")
        [[ -n "$TASK_ID" ]] && echo "[TASK_ID] $TASK_ID"
      fi
      ;;
    error)
      FINAL_STATUS="error"
      FINAL_MSG="$PAYLOAD"
      if [[ -z "$TASK_ID" ]]; then
        TASK_ID=$(echo "$PAYLOAD" | python3 -c "import sys,re; m=re.search(r'\[taskId:\s*([^\]]+)\]', sys.stdin.read()); print(m.group(1).strip() if m else '')" 2>/dev/null || echo "")
        [[ -n "$TASK_ID" ]] && echo "[TASK_ID] $TASK_ID"
      fi
      ;;
  esac
done < <(curl -sN -X POST "$API" \
  -H "Content-Type: application/json" \
  -d "$BODY")

# 停止后台轮询
[[ -n "$POLL_PID" ]] && kill "$POLL_PID" 2>/dev/null || true
POLL_PID=""

# 最终输出一次完整状态（给 OpenClaw 展示截图）
if [[ -n "$TASK_ID" ]]; then
  sleep 2
  curl -s "${STATUS_API}?taskId=${TASK_ID}" 2>/dev/null | python3 - <<'PYEOF'
import json, sys
try:
    data = json.load(sys.stdin)
    cps = data.get('checkpoints', [])
    for cp in cps:
        print(f"[PROGRESS] {cp['name']}:{cp['status']}:{cp.get('message','')}")
        if cp.get('screenshotUrl'):
            print(f"[SCREENSHOT] {cp['name']}:http://localhost:1007{cp['screenshotUrl']}")
except Exception:
    pass
PYEOF
fi

# 输出最终结果
if [[ "$FINAL_STATUS" == "done" ]]; then
  CLEAN_MSG=$(echo "$FINAL_MSG" | sed 's/ \[taskId:[^]]*\]//')
  echo "[DONE] $CLEAN_MSG"
  exit 0
else
  CLEAN_MSG=$(echo "$FINAL_MSG" | sed 's/ \[taskId:[^]]*\]//')
  echo "[ERROR] ${CLEAN_MSG:-未知错误}"
  exit 1
fi
