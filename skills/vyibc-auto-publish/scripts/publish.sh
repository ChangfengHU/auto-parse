#!/bin/bash
# 一键发布视频到抖音脚本
# 用法：bash publish.sh "<ossUrl>" "<title>" ["<description>"] ["tag1,tag2,tag3"]
#
# 示例：
#   bash publish.sh "https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/xxx.mp4" "视频标题"
#   bash publish.sh "https://...xxx.mp4" "视频标题" "正文内容，可以很长" "测试,AI,创作"
#   bash publish.sh "https://...xxx.mp4" "视频标题" "" "测试,AI"

OSS_URL="${1}"
TITLE="${2}"
DESCRIPTION="${3}"
TAGS="${4}"

if [ -z "$OSS_URL" ]; then
  echo '[ERROR] 请提供 OSS 视频地址' && exit 1
fi
if [ -z "$TITLE" ]; then
  echo '[ERROR] 请提供发布标题' && exit 1
fi

# 构建 tags JSON 数组
if [ -n "$TAGS" ]; then
  TAGS_JSON=$(echo "$TAGS" | python3 -c "
import sys, json
tags = [t.strip() for t in sys.stdin.read().strip().split(',') if t.strip()]
print(json.dumps(tags))
")
else
  TAGS_JSON="[]"
fi

BODY=$(python3 -c "
import json, sys
d = {
  'videoUrl': sys.argv[1],
  'title': sys.argv[2],
  'tags': ${TAGS_JSON}
}
if sys.argv[3]:
  d['description'] = sys.argv[3]
print(json.dumps(d))
" "${OSS_URL}" "${TITLE}" "${DESCRIPTION}")

QR_FILE="/tmp/douyin-qr-$(date +%s).png"

# 调用 SSE 接口，实时输出进度
curl -s -N -X POST "https://parse.vyibc.com/api/publish" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  | while IFS= read -r line; do
    if [[ "$line" == data:* ]]; then
      json="${line#data: }"
      type=$(echo "$json" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('type',''))" 2>/dev/null)
      payload=$(echo "$json" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('payload',''))" 2>/dev/null)

      case "$type" in
        log)
          echo "$payload"
          ;;
        qrcode)
          if [[ "$payload" == http* ]]; then
            # 收到的是 OSS URL
            curl -s "$payload" -o "${QR_FILE}"
          else
            # 收到的是 base64 数据（兼容旧版）
            echo "$payload" | python3 -c "
import sys, base64
data = sys.stdin.read().strip()
if data.startswith('data:image'):
    data = data.split(',', 1)[1]
with open('${QR_FILE}', 'wb') as f:
    f.write(base64.b64decode(data))
" 2>/dev/null
          fi
          echo "[QRCODE_FILE] ${QR_FILE}"
          echo "请用抖音 App 扫描内容中的二维码登录（约3分钟有效）"
          ;;

        done)
          echo "[DONE] $payload"
          ;;
        error)
          echo "[ERROR] $payload"
          exit 1
          ;;
      esac
    fi
  done
