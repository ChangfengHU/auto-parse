#!/usr/bin/env bash
# 查询抖音登录状态
# 用法: bash check-login.sh <clientId>

CLIENT_ID="${1:-}"
BASE_URL="${VYIBC_BASE_URL:-https://parse.vyibc.com}"

if [ -z "$CLIENT_ID" ]; then
  echo "用法: bash check-login.sh <clientId>"
  echo "示例: bash check-login.sh dy_cf8b7ec6f2424b7db449f2d7ecf20ae9"
  exit 1
fi

RESPONSE=$(curl -s "${BASE_URL}/api/login/status?clientId=${CLIENT_ID}")

LOGGED_IN=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d.get('loggedIn',False)).lower())" 2>/dev/null)
MESSAGE=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message') or d.get('error','未知错误'))" 2>/dev/null)
ACCOUNT=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('account') or '')" 2>/dev/null)
UPDATED=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('updatedAt') or '')" 2>/dev/null)

echo "凭证：$CLIENT_ID"
echo "状态：$MESSAGE"
[ -n "$ACCOUNT" ] && echo "账号：$ACCOUNT"
[ -n "$UPDATED" ] && echo "同步：$UPDATED"

if [ "$LOGGED_IN" = "true" ]; then
  echo ""
  echo "LOGIN_STATUS=ok"
  exit 0
else
  echo ""
  echo "LOGIN_STATUS=not_logged_in"
  exit 1
fi
