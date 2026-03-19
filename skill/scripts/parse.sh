#!/bin/bash
# 视频解析脚本
# 用法：bash parse.sh "<url>" [watermark]
# watermark: true=有水印快速模式, false=无水印(默认)
#
# 示例：
#   bash parse.sh "https://v.douyin.com/m7Tw65kygH8/"
#   bash parse.sh "https://v.douyin.com/m7Tw65kygH8/" true

URL="${1}"
WATERMARK="${2:-false}"

if [ -z "$URL" ]; then
  echo '{"error": "请提供视频链接"}' && exit 1
fi

curl -s -X POST "https://parse.vyibc.com/api/parse" \
  -H "Content-Type: application/json" \
  -d "{\"url\": $(echo "$URL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))'), \"watermark\": $WATERMARK}" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
if d.get('success'):
    print('✅ 解析成功（' + ('有水印' if d.get('watermark') else '无水印') + '）')
    print('📌 标题：' + d.get('title','（无标题）'))
    print('🔗 OSS地址：' + d.get('ossUrl',''))
    print('🌐 原始地址：' + d.get('videoUrl',''))
    print('🏷️  平台：' + d.get('platform','') + ' | 视频ID：' + d.get('videoId',''))
    print('')
    print(json.dumps(d, ensure_ascii=False, indent=2))
else:
    print('❌ 解析失败：' + d.get('error','未知错误'))
    sys.exit(1)
"
