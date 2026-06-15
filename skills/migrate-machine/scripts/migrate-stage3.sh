#!/usr/bin/env bash
# migrate-stage3.sh — 迁移阶段三（Pause B 后继续）
# 用法: migrate-stage3.sh <NEW_IP> [SSH_KEY] [DOMAIN_BASE]
#
# 执行：阶段十三（e2e 测试）、阶段十四（skill 发布）、阶段十五（输出汇总）

set -euo pipefail

NEW_IP="${1:-}"
SSH_KEY="${2:-$HOME/.secrets/new-machine-key}"
DOMAIN_BASE="${3:-vyibc.com}"

if [[ -z "$NEW_IP" ]]; then
  echo "用法: $0 <NEW_IP> [SSH_KEY] [DOMAIN_BASE]" >&2
  exit 1
fi

MACHINE_ID="${NEW_IP##*.}"
PARSE_DOMAIN="parse-${MACHINE_ID}.${DOMAIN_BASE}"
VNC_DOMAIN="vnc-${MACHINE_ID}.${DOMAIN_BASE}"
SKILL_NAME="vyibc-style-images-${MACHINE_ID}"
REMOTE_USER="a01020323900"
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no $REMOTE_USER@$NEW_IP"
PROJECT_DIR="/home/a01020323900/code/auto-parse"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "▶ 阶段十三：端到端验证"

WFID="4a163587-6e5e-4176-8178-0915f0429ee0"
TASK=$($SSH_CMD "curl -s -X POST 'http://localhost:3007/api/gemini-web/image/ads-dispatcher' \
  -H 'Content-Type: application/json' -H 'User-Agent: Mozilla/5.0' \
  -d '{\"workflowId\":\"$WFID\",\"runs\":[{\"prompt\":\"一只可爱的猫咪，只输出一张静态图片，不要文字\",\"sourceImageUrl\":null}]}'")
TASK_ID=$(echo "$TASK" | python3 -c "import sys,json; print(json.load(sys.stdin).get('taskId',''))" 2>/dev/null)

if [[ -z "$TASK_ID" ]]; then
  echo "   ❌ 任务提交失败: $TASK" >&2
  exit 1
fi
echo "   任务已提交: $TASK_ID"
echo "   监控: https://${PARSE_DOMAIN}/ads-dispatcher/${TASK_ID}"

# 轮询（最多 6 分钟）
RESULT_URL=""
for i in $(seq 1 24); do
  sleep 15
  STATUS=$($SSH_CMD "curl -s 'http://localhost:3007/api/gemini-web/image/ads-dispatcher/tasks/$TASK_ID/summary'" \
    | python3 -c "
import sys,json
d=json.load(sys.stdin)
status=d.get('status','?')
items=d.get('items',[])
url=items[0].get('primaryMediaUrl','') if items else ''
print(status, url)
" 2>/dev/null)
  echo "   [$i] $STATUS"
  echo "$STATUS" | grep -q "^success" && { RESULT_URL=$(echo "$STATUS" | awk '{print $2}'); break; }
  echo "$STATUS" | grep -q "^failed" && { echo "   ❌ 任务失败"; exit 1; }
done

if [[ -z "$RESULT_URL" ]]; then
  echo "   ⚠️  超时，请手动检查任务状态"
  exit 1
fi
echo "   ✅ e2e 验证通过！图片: $RESULT_URL"

# ── 阶段十四：发布 skill ─────────────────────────────────────────────────────
echo ""
echo "▶ 阶段十四：发布 $SKILL_NAME"

TMPSKILL="/tmp/${SKILL_NAME}"
rm -rf "$TMPSKILL"
cp -r "$PROJECT_DIR/skills/vyibc-style-images/." "$TMPSKILL/"

sed -i "s/^name: vyibc-style-images$/name: ${SKILL_NAME}/" "$TMPSKILL/SKILL.md"
sed -i "s|https://parse.vyibc.com|https://${PARSE_DOMAIN}|g" "$TMPSKILL/scripts/call_dispatcher.py"
sed -i "s|https://parse.vyibc.com|https://${PARSE_DOMAIN}|g" "$TMPSKILL/SKILL.md"

PUBLISH_RESULT=$(ALLOW_EXTERNAL_SKILL_DIR=1 \
  "$HOME/.claude/skills/publish-skill/scripts/publish-skill.sh" \
  "$SKILL_NAME" "$TMPSKILL" 2>&1)
echo "$PUBLISH_RESULT" | grep -E "install|✅|❌" | head -10
rm -rf "$TMPSKILL"

INSTALL_CMD=$(echo "$PUBLISH_RESULT" | grep "curl -fsSL" | head -1 | xargs)
echo "   ✅ Skill 发布完成"

# ── 阶段十五：写入文档 + 输出汇总 ───────────────────────────────────────────
echo ""
echo "▶ 阶段十五：生成文档 docs/MACHINE_${MACHINE_ID}_ENV.md"

DOC_PATH="$PROJECT_DIR/docs/MACHINE_${MACHINE_ID}_ENV.md"
cat > "$DOC_PATH" << DOCEOF
# Machine ${MACHINE_ID} 环境说明（${NEW_IP}）

## 快速地址汇总

| 用途 | 地址 |
|------|------|
| 🖥️ VNC 远程桌面 | https://${VNC_DOMAIN}/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote |
| 🌐 Auto-parse API | https://${PARSE_DOMAIN} |
| 📊 Dispatcher 监控 | https://${PARSE_DOMAIN}/ads-dispatcher |
| 📦 Skill 安装命令 | \`${INSTALL_CMD}\` |

## AdsPower 分身

代理：\`http://127.0.0.1:7890\`（proxy7890 服务）

## Systemd 服务（用户级）

| 服务 | 说明 |
|------|------|
| adspower.service | AdsPower 带桌面运行 |
| auto-parse.service | Next.js 生产服务，端口 3007 |
| proxy7890.service | 本地 HTTP 代理，端口 7890 |
| ads-watchdog.timer | 每 30s 检测 ADS 实例存活 |

VNC（系统级）：vnc-xvfb, vnc-openbox, vnc-x11vnc, vnc-websockify

## 维护命令

\`\`\`bash
# SSH 登录
ssh -i ~/.secrets/new-machine-key $REMOTE_USER@${NEW_IP}

# 查看 auto-parse 日志
ssh ... "journalctl --user -u auto-parse.service -f"

# 重启 auto-parse
ssh ... "systemctl --user restart auto-parse.service"

# 查看 ADS 实例状态
curl https://${PARSE_DOMAIN}/api/image-generate/ads-pool/status
\`\`\`

## 生成时间

$(date -u +%Y-%m-%dT%H:%M:%SZ)
DOCEOF

echo "   ✅ 文档已写入 $DOC_PATH"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 迁移完成！机器 ${MACHINE_ID}（${NEW_IP}）已就绪"
echo ""
echo "🖥️  VNC:    https://${VNC_DOMAIN}/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote"
echo "🌐  API:    https://${PARSE_DOMAIN}"
echo "📊  监控:   https://${PARSE_DOMAIN}/ads-dispatcher"
echo "📦  Skill:  ${INSTALL_CMD}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
