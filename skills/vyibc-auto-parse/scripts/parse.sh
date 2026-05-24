#!/bin/bash
# 视频解析脚本
# 用法：bash parse.sh "<url>" [watermark]
# watermark: true=有水印快速模式, false=无水印(默认，需 Cookie + Playwright)
#
# 环境变量（可选）：
#   PARSE_API_BASE      默认 https://parse.vyibc.com，本地 http://localhost:1007
#   DOUYIN_COOKIE       指定登录 Cookie（无水印）
#   PARSE_CLIENT_ID     插件凭证 dy_xxx（无水印）
#   PARSE_EXPORT_PROVIDER  oss | supabase | r2
#
# 示例：
#   bash parse.sh "https://v.douyin.com/m7Tw65kygH8/"
#   DOUYIN_COOKIE='sessionid=...' bash parse.sh "https://v.douyin.com/xxx/"
#   PARSE_CLIENT_ID='dy_xxx' bash parse.sh "https://v.douyin.com/xxx/"

URL="${1}"
WATERMARK="${2:-false}"
API_BASE="${PARSE_API_BASE:-https://parse.vyibc.com}"

if [ -z "$URL" ]; then
  echo '{"error": "请提供视频链接"}' && exit 1
fi

# 构建 JSON body
python3 - "$URL" "$WATERMARK" <<'PY' > /tmp/parse_body.json
import json, os, sys
url, wm = sys.argv[1], sys.argv[2].lower() in ('1', 'true', 'yes')
body = {"url": url, "watermark": wm}
cookie = os.environ.get("DOUYIN_COOKIE", "").strip()
client_id = os.environ.get("PARSE_CLIENT_ID", "").strip()
provider = os.environ.get("PARSE_EXPORT_PROVIDER", "").strip()
if cookie:
    body["auth"] = {"mode": "custom", "type": "cookie", "cookieStr": cookie}
elif client_id:
    body["auth"] = {"mode": "custom", "type": "credential", "clientId": client_id}
if provider in ("oss", "supabase", "r2"):
    body["export"] = {"provider": provider}
print(json.dumps(body, ensure_ascii=False))
PY

curl -s -X POST "${API_BASE}/api/parse" \
  -H "Content-Type: application/json" \
  -d @/tmp/parse_body.json \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
if d.get('success'):
    wm = d.get('watermark')
    prov = d.get('uploadProvider', '')
    print('✅ 解析成功（' + ('有水印' if wm else '无水印') + (' · ' + prov if prov else '') + '）')
    print('📌 标题：' + d.get('title','（无标题）'))
    print('🔗 永久地址：' + d.get('ossUrl',''))
    print('🌐 原始地址：' + d.get('videoUrl',''))
    print('🏷️  平台：' + d.get('platform','') + ' | 视频ID：' + d.get('videoId',''))
    if d.get('authSource'):
        print('🔐 登录来源：' + d.get('authSource'))
    print('')
    print(json.dumps(d, ensure_ascii=False, indent=2))
else:
    print('❌ 解析失败：' + d.get('error','未知错误'))
    sys.exit(1)
"
