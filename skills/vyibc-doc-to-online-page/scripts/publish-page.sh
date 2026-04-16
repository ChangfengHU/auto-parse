#!/usr/bin/env bash
set -euo pipefail

# 默认使用专用的上传发布接口
BASE_URL="${BASE_URL:-https://upload.vyibc.com}"
TITLE=""
FILE=""
CONTENT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --title) TITLE="$2"; shift 2 ;;
    --file) FILE="$2"; shift 2 ;;
    --content) CONTENT="$2"; shift 2 ;;
    *)
      echo "[ERROR] 未知参数: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$FILE" && -z "$CONTENT" ]]; then
  echo "[ERROR] 需要 --file 或 --content 其中一个" >&2
  exit 1
fi

# 如果提供的是文件，读取内容
if [[ -n "$FILE" ]]; then
  if [[ ! -f "$FILE" ]]; then
    echo "[ERROR] 文件不存在: $FILE" >&2
    exit 1
  fi
  CONTENT=$(cat "$FILE")
  if [[ -z "$TITLE" ]]; then
    TITLE=$(basename "$FILE")
  fi
fi

if [[ -z "$TITLE" ]]; then
  TITLE="Untitled Page"
fi

echo "📤 正在发布到在线页面..."

# 构建适配 documents:toPage 的 Payload
JSON_PAYLOAD=$(
  jq -n \
    --arg title "$TITLE" \
    --arg content "$CONTENT" \
    '{
      title: $title,
      content: $content
    }'
)

# 调用工业级 toPage 接口
RESP=$(curl -sS -X POST "${BASE_URL}/v1beta/documents:toPage" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD")

# 解析结果
PAGE_URL=$(echo "$RESP" | jq -r '.page_url // .pageUrl // empty')

if [[ -z "$PAGE_URL" ]]; then
  ERROR_MSG=$(echo "$RESP" | jq -r '.error // "发布失败，接口未返回有效 URL"')
  echo "[ERROR] $ERROR_MSG" >&2
  echo "DEBUG: $RESP" >&2
  exit 1
fi

echo ""
echo "✅ 发布成功！"
echo "[PAGE_URL] $PAGE_URL"
echo "[DONE]"
