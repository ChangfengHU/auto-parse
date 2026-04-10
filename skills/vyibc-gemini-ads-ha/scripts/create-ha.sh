#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://parses.vyibc.com}"
INSTANCE_IDS="${INSTANCE_IDS:-k1b908rw,k1bc2kj2,k1bc2kja}"
MAX_CONCURRENCY="${MAX_CONCURRENCY:-3}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-6}"
WORKFLOW_ID="${WORKFLOW_ID:-}"

read -r -d '' DEFAULT_PROMPTS_JSON << 'EOF' || true
[
  "赛博朋克城市夜景，霓虹灯，电影感，8k",
  "北欧极简客厅，清晨自然光，写实摄影，高级质感",
  "情侣校园散步，电影感，8k",
  "秋日森林木屋，阳光透过树叶，写实摄影",
  "未来感电商产品主视觉，悬浮平台，体积光",
  "海边日落人像，胶片颗粒，暖色调",
  "现代办公室团队协作场景，明亮自然光，商业摄影",
  "国潮风神兽插画，细节丰富，海报构图",
  "极简白色厨房空间，杂志风室内摄影",
  "雨夜街头反光路面，电影级光影，广角镜头"
]
EOF

PROMPTS_JSON="$DEFAULT_PROMPTS_JSON"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --instance-ids) INSTANCE_IDS="$2"; shift 2 ;;
    --max-concurrency) MAX_CONCURRENCY="$2"; shift 2 ;;
    --max-attempts) MAX_ATTEMPTS="$2"; shift 2 ;;
    --workflow-id) WORKFLOW_ID="$2"; shift 2 ;;
    --prompts-json) PROMPTS_JSON="$2"; shift 2 ;;
    *)
      echo "[ERROR] 未知参数: $1" >&2
      exit 1
      ;;
  esac
done

BODY=$(
  jq -n \
    --argjson prompts "$PROMPTS_JSON" \
    --arg instanceIds "$INSTANCE_IDS" \
    --arg workflowId "$WORKFLOW_ID" \
    --argjson maxConcurrency "$MAX_CONCURRENCY" \
    --argjson maxAttemptsPerPrompt "$MAX_ATTEMPTS" \
    '{
      prompts: $prompts,
      instanceIds: ($instanceIds | split(",") | map(gsub("^\\s+|\\s+$";"")) | map(select(length>0))),
      maxConcurrency: $maxConcurrency,
      maxAttemptsPerPrompt: $maxAttemptsPerPrompt,
      autoCloseTab: false
    } + (if $workflowId == "" then {} else {workflowId: $workflowId} end)'
)

RESP=$(curl -sS -X POST "${BASE_URL}/api/gemini-web/image/ads-ha" \
  -H "Content-Type: application/json" \
  -d "$BODY")

TASK_ID=$(echo "$RESP" | jq -r '.taskId // empty')
if [[ -z "$TASK_ID" ]]; then
  echo "$RESP" | jq .
  echo "[ERROR] 创建失败" >&2
  exit 1
fi

echo "$RESP" | jq .
echo "[TASK_ID] $TASK_ID"
