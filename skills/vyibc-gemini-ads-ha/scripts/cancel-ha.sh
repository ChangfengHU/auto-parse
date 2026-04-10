#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://parses.vyibc.com}"
TASK_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --task-id) TASK_ID="$2"; shift 2 ;;
    *)
      echo "[ERROR] 未知参数: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$TASK_ID" ]]; then
  echo "[ERROR] 需要 --task-id" >&2
  exit 1
fi

curl -sS -X POST "${BASE_URL}/api/gemini-web/image/ads-ha/tasks/${TASK_ID}/cancel" | jq .

