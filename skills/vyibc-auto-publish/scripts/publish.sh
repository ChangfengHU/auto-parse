#!/bin/bash
# 一键发布视频到抖音脚本
# 用法：bash publish.sh "<ossUrl>" "<title>" ["tag1,tag2,tag3"]
#
# 示例：
#   bash publish.sh "https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/xxx.mp4" "视频标题"
#   bash publish.sh "https://...xxx.mp4" "视频标题" "测试,AI,创作"

OSS_URL="${1}"
TITLE="${2}"
TAGS="${3}"

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
import json
print(json.dumps({
  'videoUrl': '${OSS_URL}',
  'title': '${TITLE}',
  'tags': ${TAGS_JSON}
}))
")

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
        log)    echo "$payload" ;;
        qrcode) echo "[QRCODE] 请在网页端扫码登录（打开 http://localhost:1007 查看二维码）" ;;
        done)   echo "[DONE] $payload" ;;
        error)  echo "[ERROR] $payload"; exit 1 ;;
      esac
    fi
  done
