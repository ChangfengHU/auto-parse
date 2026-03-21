#!/bin/bash
# 查询抖音发布任务状态脚本
# 用法：
#   bash status.sh                      # 列出最近20条任务
#   bash status.sh <taskId>             # 查询指定任务详情
#   bash status.sh <taskId> --qr        # 下载并展示二维码（需要扫码时）
#   bash status.sh <taskId> --screenshots # 下载所有阶段截图
#
# 示例：
#   bash status.sh
#   bash status.sh 2026-03-22T10-00-00-abc12
#   bash status.sh 2026-03-22T10-00-00-abc12 --qr

# 服务基础地址，优先读取环境变量
BASE_URL="${VYIBC_BASE_URL:-https://parse.vyibc.com}"

TASK_ID="${1}"
OPTION="${2}"

# ─────────────────────────────────────────
# 工具函数：状态转为 emoji 图标
# ─────────────────────────────────────────
status_icon() {
  case "$1" in
    ok)      echo "✅" ;;
    running) echo "🔄" ;;
    warn)    echo "⚠️ " ;;
    error)   echo "❌" ;;
    skip)    echo "⏭️ " ;;
    *)       echo "⏳" ;;
  esac
}

# ─────────────────────────────────────────
# 无 taskId：列出最近20条任务
# ─────────────────────────────────────────
if [ -z "$TASK_ID" ]; then
  echo "📋 查询最近发布任务列表..."
  echo ""

  curl -s "${BASE_URL}/api/publish/status" \
    | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
if not tasks:
    print('暂无发布任务记录')
    sys.exit(0)

for t in tasks:
    status = t.get('status', '?')
    icon = {'success': '✅', 'running': '🔄', 'failed': '❌'}.get(status, '⏳')
    print(f\"{icon} [{t.get('startTime','')[:19]}] {t.get('title','（无标题）')}\")
    print(f\"   taskId: {t.get('taskId','?')} | 状态: {status}\")
    print('')
"
  exit 0
fi

# ─────────────────────────────────────────
# 有 taskId：查询单个任务详情
# ─────────────────────────────────────────
echo "🔍 查询任务状态：$TASK_ID"
echo ""

RESPONSE=$(curl -s "${BASE_URL}/api/publish/status?taskId=${TASK_ID}")

if [ -z "$RESPONSE" ]; then
  echo "❌ 接口无响应，请确认服务已启动（${BASE_URL}）"
  exit 1
fi

# 检查是否是 404 / 错误
ERROR=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null)
if [ -n "$ERROR" ]; then
  echo "❌ 查询失败：$ERROR"
  exit 1
fi

# ─── 输出任务摘要 ───
echo "$RESPONSE" | python3 -c "
import sys, json

d = json.load(sys.stdin)
status = d.get('status', '?')
icon = {'success': '✅', 'running': '🔄', 'failed': '❌'}.get(status, '⏳')

print(f\"{icon} 任务状态：{status}\")
print(f\"🆔 taskId：{d.get('taskId','?')}\")
print('')

# 各阶段进度
checkpoints = d.get('checkpoints', [])
if checkpoints:
    print('── 阶段进度 ──────────────────────')
    icons = {'ok':'✅','running':'🔄','warn':'⚠️ ','error':'❌','skip':'⏭️ '}
    for cp in checkpoints:
        ico = icons.get(cp.get('status',''), '⏳')
        msg = cp.get('message','')
        name = cp.get('name','?')
        line = f\"  {ico} {name}\"
        if msg:
            line += f\"  — {msg}\"
        print(line)
    print('')

# 需要扫码提示
if d.get('needsQrScan'):
    print('⚠️  ──────────────────────────────────')
    print('⚠️  Cookie 已过期，需要扫码登录！')
    print('⚠️  运行以下命令下载二维码：')
    print(f\"   bash status.sh {d.get('taskId','')} --qr\")
    print('⚠️  ──────────────────────────────────')
    print('')

# 最近日志
logs = d.get('logs', [])
if logs:
    print('── 最近日志（最后10条）──────────────')
    for log in logs[-10:]:
        print(f\"  {log}\")
"

# ─── --qr 模式：下载并展示二维码 ───
if [ "$OPTION" = "--qr" ]; then
  echo ""
  echo "📷 下载二维码..."

  QR_URL=$(echo "$RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
url = d.get('latestQrUrl','')
if url:
    print(url)
" 2>/dev/null)

  if [ -z "$QR_URL" ]; then
    echo "⚠️  当前任务不需要扫码，或二维码尚未生成"
    exit 0
  fi

  QR_FILE="/tmp/douyin-qr-$(date +%s).png"
  
  if [[ "$QR_URL" == http* ]]; then
    FULL_URL="$QR_URL"
  else
    FULL_URL="${BASE_URL}${QR_URL}"
  fi

  curl -s "$FULL_URL" -o "$QR_FILE"

  if [ -f "$QR_FILE" ] && [ -s "$QR_FILE" ]; then
    echo "[QRCODE_FILE] ${QR_FILE}"
    echo "✅ 二维码已保存：${QR_FILE}"
    echo "📱 请用抖音 App 扫描上面的二维码（约3分钟有效）"
  else
    echo "❌ 二维码下载失败：URL $FULL_URL"
    exit 1
  fi
fi

# ─── --screenshots 模式：下载所有阶段截图 ───
if [ "$OPTION" = "--screenshots" ]; then
  echo ""
  echo "🖼️  下载阶段截图..."

  echo "$RESPONSE" | python3 -c "
import sys, json, subprocess, os

d = json.load(sys.stdin)
base_url = '${BASE_URL}'
checkpoints = d.get('checkpoints', [])
has_screenshot = False

for cp in checkpoints:
    url = cp.get('screenshotUrl','')
    name = cp.get('name','?')
    if not url:
        continue
    has_screenshot = True
    out_file = f'/tmp/stage-{name}.png'
    full_url = url if url.startswith('http') else base_url + url
    r = subprocess.run(['curl', '-s', full_url, '-o', out_file], capture_output=True)
    if os.path.exists(out_file) and os.path.getsize(out_file) > 0:
        print(f'[SCREENSHOT] {name}:{out_file}')
    else:
        print(f'⚠️  {name} 截图下载失败: {full_url}')

if not has_screenshot:
    print('暂无截图（任务还在运行中，或尚未到截图阶段）')
"
fi
