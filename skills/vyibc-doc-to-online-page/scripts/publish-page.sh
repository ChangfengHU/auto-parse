#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
TITLE=""
FILE=""
CONTENT=""
FOLDER="${FOLDER:-doc-pages}"
OBJECT_KEY="${OBJECT_KEY:-}"
PROVIDER="${PROVIDER:-doc-to-page}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --title) TITLE="$2"; shift 2 ;;
    --file) FILE="$2"; shift 2 ;;
    --content) CONTENT="$2"; shift 2 ;;
    --folder) FOLDER="$2"; shift 2 ;;
    --object-key) OBJECT_KEY="$2"; shift 2 ;;
    --provider) PROVIDER="$2"; shift 2 ;;
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

if [[ -n "$FILE" ]]; then
  if [[ "$FILE" != /* ]]; then
    FILE="$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")"
  fi
fi

JSON_PAYLOAD=$(
  jq -n \
    --arg title "$TITLE" \
    --arg content "$CONTENT" \
    --arg filePath "$FILE" \
    --arg folder "$FOLDER" \
    --arg objectKey "$OBJECT_KEY" \
    --arg provider "$PROVIDER" \
    '{
      title: (if $title == "" then null else $title end),
      content: (if $content == "" then null else $content end),
      filePath: (if $filePath == "" then null else $filePath end),
      folder: (if $folder == "" then null else $folder end),
      objectKey: (if $objectKey == "" then null else $objectKey end),
      provider: (if $provider == "" then "doc-to-page" else $provider end)
    }'
)

RESP=$(curl -sS -X POST "${BASE_URL}/api/docs/publish-page" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD")

OK=$(echo "$RESP" | jq -r '.success // false')
if [[ "$OK" != "true" ]]; then
  echo "[ERROR] $(echo "$RESP" | jq -r '.error // "发布失败"')" >&2
  exit 1
fi

echo "[PAGE_URL] $(echo "$RESP" | jq -r '.pageUrl')"
echo "[OSS_KEY] $(echo "$RESP" | jq -r '.key')"
echo "[DONE] 发布成功"
