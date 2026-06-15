#!/usr/bin/env bash
# migrate-stage2.sh — 迁移阶段二（Pause A 后继续）
# 用法: migrate-stage2.sh <NEW_IP> <ADS_ID1,ADS_ID2,ADS_ID3> [SSH_KEY] [DOMAIN_BASE]
#
# 执行：阶段十（填写 ADS IDs）、阶段十一（watchdog）、阶段十二（build+服务）
# 然后暂停等 Gemini 登录（Pause B）

set -euo pipefail

NEW_IP="${1:-}"
ADS_IDS="${2:-}"
SSH_KEY="${3:-$HOME/.secrets/new-machine-key}"
DOMAIN_BASE="${4:-vyibc.com}"

if [[ -z "$NEW_IP" || -z "$ADS_IDS" ]]; then
  echo "用法: $0 <NEW_IP> <ADS_ID1,ADS_ID2,ADS_ID3> [SSH_KEY] [DOMAIN_BASE]" >&2
  exit 1
fi

MACHINE_ID="${NEW_IP##*.}"
PARSE_DOMAIN="parse-${MACHINE_ID}.${DOMAIN_BASE}"
VNC_DOMAIN="vnc-${MACHINE_ID}.${DOMAIN_BASE}"
REMOTE_USER="a01020323900"
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no $REMOTE_USER@$NEW_IP"
PROJECT_DIR="/home/a01020323900/code/auto-parse"
SCP_CMD="scp -i $SSH_KEY -o StrictHostKeyChecking=no"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "▶ 阶段十：填写 ADS_INSTANCE_POOL_IDS"
$SSH_CMD "
sed -i 's|^ADS_INSTANCE_POOL_IDS=.*|ADS_INSTANCE_POOL_IDS=${ADS_IDS}|' \
  /home/$REMOTE_USER/code/auto-parse/.env.local
grep ADS_INSTANCE_POOL_IDS /home/$REMOTE_USER/code/auto-parse/.env.local
"
echo "   ✅ ADS IDs 写入完成"

echo ""
echo "▶ 阶段十一：ads-watchdog systemd timer"

$SCP_CMD "$PROJECT_DIR/scripts/ads-watchdog.sh" \
  "$REMOTE_USER@$NEW_IP:/home/$REMOTE_USER/code/auto-parse/scripts/ads-watchdog.sh"

$SSH_CMD "
chmod +x /home/$REMOTE_USER/code/auto-parse/scripts/ads-watchdog.sh
mkdir -p /home/$REMOTE_USER/.config/systemd/user

cat > /home/$REMOTE_USER/.config/systemd/user/ads-watchdog.service << 'EOF'
[Unit]
Description=AdsPower instance watchdog
[Service]
Type=oneshot
ExecStart=/home/$REMOTE_USER/code/auto-parse/scripts/ads-watchdog.sh
EOF

cat > /home/$REMOTE_USER/.config/systemd/user/ads-watchdog.timer << 'EOF'
[Unit]
Description=AdsPower watchdog timer
[Timer]
OnBootSec=60
OnUnitActiveSec=30
Unit=ads-watchdog.service
[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now ads-watchdog.timer
systemctl --user is-active ads-watchdog.timer
"
echo "   ✅ 阶段十一完成"

echo ""
echo "▶ 阶段十二：next build + auto-parse 服务"

# 同步 next.config.ts（含 ignoreBuildErrors）
$SCP_CMD "$PROJECT_DIR/next.config.ts" \
  "$REMOTE_USER@$NEW_IP:/home/$REMOTE_USER/code/auto-parse/next.config.ts"

echo "   执行 next build（约 2-3 分钟）..."
$SSH_CMD "sh -c 'cd /home/$REMOTE_USER/code/auto-parse && npm run build 2>&1 | tail -20'"

$SSH_CMD "
cat > /home/$REMOTE_USER/.config/systemd/user/auto-parse.service << 'EOF'
[Unit]
Description=auto-parse Next.js service
After=network.target
[Service]
Type=simple
WorkingDirectory=/home/$REMOTE_USER/code/auto-parse
EnvironmentFile=/home/$REMOTE_USER/code/auto-parse/.env.local
ExecStart=/usr/bin/npm run start -- -p 3007
Restart=on-failure
RestartSec=5
[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now auto-parse.service
sleep 8
curl -s -o /dev/null -w '%{http_code}' http://localhost:3007/ && echo ' ← localhost:3007 OK'
"
echo "   ✅ 阶段十二完成"

# ── ⏸️ 暂停点 B ─────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⏸️  暂停点 B：请用户完成 Gemini 账号登录"
echo ""
echo "   VNC 地址: https://${VNC_DOMAIN}/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote"
echo ""
echo "   请在 VNC 桌面中，对 3 个 AdsPower 分身依次："
echo "   1. 点击「打开」启动浏览器"
echo "   2. 访问 https://gemini.google.com"
echo "   3. 登录 Google 账号"
echo ""
echo "   全部登录完成后告知，继续执行阶段十三（e2e 测试）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PAUSE_B:waiting_for_gemini_login"
