#!/usr/bin/env bash
# migrate.sh — auto-parse 新机器迁移脚本
# 用法: migrate.sh <NEW_IP> [SSH_KEY] [DOMAIN_BASE]
# 示例: migrate.sh 34.29.222.183
#       migrate.sh 34.29.222.183 ~/.secrets/my-key vyibc.com
#
# 环境变量（可覆盖）:
#   CF_KEY        Cloudflare Global API Key
#   CF_EMAIL      Cloudflare 账号邮箱
#   CF_ACCOUNT    Cloudflare Account ID
#   ADS_SOURCE    旧机器 AdsPower 目录（默认 /opt/AdsPower\ Global）

set -euo pipefail

# ── 参数 ────────────────────────────────────────────────────────────────────
NEW_IP="${1:-}"
SSH_KEY="${2:-$HOME/.secrets/new-machine-key}"
DOMAIN_BASE="${3:-vyibc.com}"

if [[ -z "$NEW_IP" ]]; then
  echo "用法: $0 <NEW_IP> [SSH_KEY] [DOMAIN_BASE]" >&2
  exit 1
fi

# 机器 ID = IP 末段
MACHINE_ID="${NEW_IP##*.}"
PARSE_DOMAIN="parse-${MACHINE_ID}.${DOMAIN_BASE}"
VNC_DOMAIN="vnc-${MACHINE_ID}.${DOMAIN_BASE}"
SKILL_NAME="vyibc-style-images-${MACHINE_ID}"
PROJECT_DIR="/home/a01020323900/code/auto-parse"
REMOTE_USER="a01020323900"
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no $REMOTE_USER@$NEW_IP"
SCP_CMD="scp -i $SSH_KEY -o StrictHostKeyChecking=no"

# CF 凭证（Global API Key，需用 X-Auth-Key + X-Auth-Email）
CF_KEY="${CF_KEY:-$(cat ~/.secrets/cloudflare-api-token 2>/dev/null || echo '')}"
CF_EMAIL="${CF_EMAIL:-$(cat ~/.secrets/cf-account-email 2>/dev/null || echo '')}"
CF_ACCOUNT="${CF_ACCOUNT:-$(cat ~/.secrets/cf-account-id 2>/dev/null || echo '')}"

# 若 Account ID 未配置，从 API 查
if [[ -z "$CF_ACCOUNT" && -n "$CF_KEY" && -n "$CF_EMAIL" ]]; then
  CF_ACCOUNT=$(curl -s "https://api.cloudflare.com/client/v4/accounts" \
    -H "X-Auth-Key: $CF_KEY" -H "X-Auth-Email: $CF_EMAIL" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result'][0]['id'])" 2>/dev/null || echo '')
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 迁移目标: $NEW_IP (机器 ID: $MACHINE_ID)"
echo "   parse 域名: $PARSE_DOMAIN"
echo "   VNC 域名:   $VNC_DOMAIN"
echo "   Skill 名:   $SKILL_NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 阶段一：磁盘检查与扩容 ──────────────────────────────────────────────────
echo ""
echo "▶ 阶段一：磁盘检查与扩容"

$SSH_CMD "
set -e
DISK_TOTAL=\$(df -BG / | awk 'NR==2{print \$2}' | tr -d G)
echo \"   当前根分区: \${DISK_TOTAL}GB\"
if [ \"\$DISK_TOTAL\" -lt 20 ]; then
  echo '   检测到磁盘可能未扩展，尝试 parted resize...'
  sudo apt-get install -y parted 2>/dev/null || true
  DISK_DEV=\$(lsblk -no PKNAME \$(findmnt -n -o SOURCE /) | head -1)
  PART_NUM=\$(lsblk -no KNAME \$(findmnt -n -o SOURCE /) | grep -oE '[0-9]+\$')
  sudo parted /dev/\${DISK_DEV} resizepart \${PART_NUM} 100% 2>/dev/null || true
  sudo resize2fs \$(findmnt -n -o SOURCE /) 2>/dev/null || true
  df -h /
fi
# Swap
if ! swapon --show | grep -q swap; then
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
  echo '   ✅ Swap 4GB 创建完成'
else
  echo '   Swap 已存在，跳过'
fi
"
echo "   ✅ 阶段一完成"

# ── 阶段二：系统依赖 ────────────────────────────────────────────────────────
echo ""
echo "▶ 阶段二：系统依赖安装"

$SSH_CMD "
export DEBIAN_FRONTEND=noninteractive
sudo rm -rf /var/cache/apt/archives/*.deb /var/lib/apt/lists/* 2>/dev/null || true
sudo apt-get update -qq
sudo apt-get install -y -qq \
  git curl wget unzip zip python3 python3-pip parted \
  xvfb x11vnc openbox websockify novnc \
  libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
  libgbm1 libgtk-3-0 libxss1 libasound2 2>/dev/null || \
sudo apt-get install -y \
  git curl wget unzip zip python3 python3-pip parted \
  xvfb x11vnc openbox websockify novnc \
  libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
  libgbm1 libgtk-3-0 libxss1 libasound2

# Node.js 20
if ! node -v 2>/dev/null | grep -q 'v20'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - > /dev/null
  sudo apt-get install -y nodejs
fi

# cloudflared
if ! command -v cloudflared &>/dev/null; then
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb
  sudo dpkg -i /tmp/cf.deb
fi

echo '127.0.0.1 local.adspower.net' | grep -qF 'local.adspower.net' /etc/hosts || \
  echo '127.0.0.1 local.adspower.net' | sudo tee -a /etc/hosts > /dev/null

echo 'node: '\$(node -v)' | cloudflared: '\$(cloudflared -v 2>&1 | head -1)
"
echo "   ✅ 阶段二完成"

# ── 阶段三：代码 clone ───────────────────────────────────────────────────────
echo ""
echo "▶ 阶段三：代码 clone + npm install + playwright"

GITHUB_TOKEN="${GITHUB_TOKEN:-$(grep GITHUB_TOKEN $PROJECT_DIR/.env.local 2>/dev/null | cut -d= -f2- | tr -d '"' || echo '')}"
REPO_URL="https://github.com/ChangfengHU/auto-parse.git"
[[ -n "$GITHUB_TOKEN" ]] && REPO_URL="https://${GITHUB_TOKEN}@github.com/ChangfengHU/auto-parse.git"

$SSH_CMD "
mkdir -p /home/$REMOTE_USER/code
if [ ! -d /home/$REMOTE_USER/code/auto-parse ]; then
  git clone '$REPO_URL' /home/$REMOTE_USER/code/auto-parse
fi
sh -c 'cd /home/$REMOTE_USER/code/auto-parse && npm install --legacy-peer-deps 2>&1 | tail -5'
sh -c 'cd /home/$REMOTE_USER/code/auto-parse && npx playwright install chromium 2>&1 | tail -3'
echo '✅ npm install 完成'
"
echo "   ✅ 阶段三完成"

# ── 阶段四：复制 .env.local ──────────────────────────────────────────────────
echo ""
echo "▶ 阶段四：复制 .env.local"

ENV_CONTENT=$(cat "$PROJECT_DIR/.env.local" | \
  sed 's|^ADS_INSTANCE_POOL_IDS=.*|ADS_INSTANCE_POOL_IDS=|' | \
  sed "s|^NEXT_PUBLIC_DEBUG_VNC_URL=.*|NEXT_PUBLIC_DEBUG_VNC_URL=https://${VNC_DOMAIN}/vnc.html?path=websockify\&autoconnect=1\&reconnect=1\&resize=remote|")

$SSH_CMD "cat > /home/$REMOTE_USER/code/auto-parse/.env.local" <<< "$ENV_CONTENT"
echo "   ✅ 阶段四完成"

# ── 阶段五：VNC 栈 ───────────────────────────────────────────────────────────
echo ""
echo "▶ 阶段五：VNC 栈 systemd 服务"

$SSH_CMD "
sudo tee /etc/systemd/system/vnc-xvfb.service > /dev/null << 'EOF'
[Unit]
Description=VNC Xvfb display :99
After=network.target
[Service]
Type=simple
ExecStart=/usr/bin/Xvfb :99 -screen 0 1440x900x24
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/vnc-openbox.service > /dev/null << 'EOF'
[Unit]
Description=Openbox window manager on :99
After=vnc-xvfb.service
Requires=vnc-xvfb.service
[Service]
Type=simple
Environment=DISPLAY=:99
ExecStart=/usr/bin/openbox-session
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/vnc-x11vnc.service > /dev/null << 'EOF'
[Unit]
Description=VNC x11vnc server on 5900
After=vnc-xvfb.service
Requires=vnc-xvfb.service
[Service]
Type=simple
ExecStart=/usr/bin/x11vnc -display :99 -rfbport 5900 -forever -shared -nopw -listen 127.0.0.1
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/vnc-websockify.service > /dev/null << 'EOF'
[Unit]
Description=VNC websockify bridge on 10006
After=vnc-x11vnc.service
Requires=vnc-x11vnc.service
[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/bin/websockify --web /usr/share/novnc/ 10006 127.0.0.1:5900
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now vnc-xvfb vnc-openbox vnc-x11vnc vnc-websockify
"
echo "   ✅ 阶段五完成"

# ── 阶段六：HTTP 代理 ─────────────────────────────────────────────────────────
echo ""
echo "▶ 阶段六：HTTP CONNECT 代理 port 7890"

PROXY_SRC="$(find /home/$REMOTE_USER/.config -name 'simple-proxy.py' 2>/dev/null | head -1)"
if [[ -n "$PROXY_SRC" ]]; then
  $SCP_CMD "$PROXY_SRC" "$REMOTE_USER@$NEW_IP:/home/$REMOTE_USER/.config/simple-proxy.py"
fi

$SSH_CMD "
mkdir -p /home/$REMOTE_USER/.config/systemd/user
cat > /home/$REMOTE_USER/.config/systemd/user/proxy7890.service << 'EOF'
[Unit]
Description=Local HTTP CONNECT Proxy on port 7890
After=network.target
[Service]
Type=simple
ExecStart=/usr/bin/python3 /home/$REMOTE_USER/.config/simple-proxy.py
Restart=always
RestartSec=3
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now proxy7890
"
echo "   ✅ 阶段六完成"

# ── 阶段七：AdsPower 安装（tar 复制）───────────────────────────────────────
echo ""
echo "▶ 阶段七：AdsPower 安装（tar 从本机复制）"

echo "   打包 AdsPower（约 1-2 分钟）..."
sudo tar czf /tmp/adspower-migrate.tar.gz -C /opt 'AdsPower Global' 2>/dev/null
$SCP_CMD /tmp/adspower-migrate.tar.gz "$REMOTE_USER@$NEW_IP:/tmp/adspower.tar.gz"
rm -f /tmp/adspower-migrate.tar.gz

$SSH_CMD "
sudo tar xzf /tmp/adspower.tar.gz -C /opt/
# 修复可能的嵌套路径
[ -d '/opt/opt/AdsPower Global' ] && sudo mv '/opt/opt/AdsPower Global' '/opt/AdsPower Global'
rm /tmp/adspower.tar.gz

mkdir -p /home/$REMOTE_USER/.config/systemd/user
cat > /home/$REMOTE_USER/.config/systemd/user/adspower.service << 'EOF'
[Unit]
Description=AdsPower Browser with Display
After=network.target
[Service]
Type=simple
Environment=DISPLAY=:99
Environment=QT_QPA_PLATFORM=xcb
ExecStart=/bin/sh -c 'exec \"/opt/AdsPower Global/adspower_global\" --no-sandbox --disable-gpu --use-gl=swiftshader'
Restart=on-failure
RestartSec=5
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now adspower
sleep 3
systemctl --user is-active adspower && echo '✅ AdsPower active' || echo '⚠️ AdsPower 启动中...'
"
echo "   ✅ 阶段七完成"

# ── 阶段八：CF Tunnel ────────────────────────────────────────────────────────
echo ""
echo "▶ 阶段八：Cloudflare Tunnel 配置"

if [[ -z "$CF_KEY" || -z "$CF_EMAIL" || -z "$CF_ACCOUNT" ]]; then
  echo "   ⚠️  CF 凭证不完整，请设置 CF_KEY / CF_EMAIL / CF_ACCOUNT 或写入 ~/.secrets/"
  echo "   跳过 CF Tunnel 自动配置，请手动创建 tunnel 后继续"
else
  # 获取 Zone ID
  ZONE_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=${DOMAIN_BASE}" \
    -H "X-Auth-Key: $CF_KEY" -H "X-Auth-Email: $CF_EMAIL" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result'][0]['id'])")

  # 创建 parse tunnel
  TUNNEL_SECRET=$(python3 -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())")
  TUNNEL_PARSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/cfd_tunnel" \
    -H "X-Auth-Key: $CF_KEY" -H "X-Auth-Email: $CF_EMAIL" -H "Content-Type: application/json" \
    -d "{\"name\":\"autoparse-${MACHINE_ID}\",\"tunnel_secret\":\"${TUNNEL_SECRET}\"}")
  TUNNEL_PARSE_ID=$(echo "$TUNNEL_PARSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['id'])")
  TUNNEL_PARSE_TOKEN=$(echo "$TUNNEL_PARSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['token'])")

  # 创建 vnc tunnel
  TUNNEL_SECRET2=$(python3 -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())")
  TUNNEL_VNC=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/cfd_tunnel" \
    -H "X-Auth-Key: $CF_KEY" -H "X-Auth-Email: $CF_EMAIL" -H "Content-Type: application/json" \
    -d "{\"name\":\"vnc-${MACHINE_ID}\",\"tunnel_secret\":\"${TUNNEL_SECRET2}\"}")
  TUNNEL_VNC_ID=$(echo "$TUNNEL_VNC" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['id'])")
  TUNNEL_VNC_TOKEN=$(echo "$TUNNEL_VNC" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['token'])")

  # 配置 ingress（用 127.0.0.1 避免 IPv6 问题）
  curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/cfd_tunnel/$TUNNEL_PARSE_ID/configurations" \
    -H "X-Auth-Key: $CF_KEY" -H "X-Auth-Email: $CF_EMAIL" -H "Content-Type: application/json" \
    -d "{\"config\":{\"ingress\":[{\"hostname\":\"${PARSE_DOMAIN}\",\"service\":\"http://127.0.0.1:3007\"},{\"service\":\"http_status:404\"}]}}" > /dev/null

  curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/cfd_tunnel/$TUNNEL_VNC_ID/configurations" \
    -H "X-Auth-Key: $CF_KEY" -H "X-Auth-Email: $CF_EMAIL" -H "Content-Type: application/json" \
    -d "{\"config\":{\"ingress\":[{\"hostname\":\"${VNC_DOMAIN}\",\"service\":\"http://127.0.0.1:10006\"},{\"service\":\"http_status:404\"}]}}" > /dev/null

  # DNS CNAME
  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
    -H "X-Auth-Key: $CF_KEY" -H "X-Auth-Email: $CF_EMAIL" -H "Content-Type: application/json" \
    -d "{\"type\":\"CNAME\",\"name\":\"parse-${MACHINE_ID}\",\"content\":\"${TUNNEL_PARSE_ID}.cfargotunnel.com\",\"proxied\":true}" > /dev/null

  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
    -H "X-Auth-Key: $CF_KEY" -H "X-Auth-Email: $CF_EMAIL" -H "Content-Type: application/json" \
    -d "{\"type\":\"CNAME\",\"name\":\"vnc-${MACHINE_ID}\",\"content\":\"${TUNNEL_VNC_ID}.cfargotunnel.com\",\"proxied\":true}" > /dev/null

  # 写入新机器
  mkdir -p ~/.tmp-migrate
  echo "$TUNNEL_PARSE_TOKEN" > ~/.tmp-migrate/parse-token
  echo "$TUNNEL_VNC_TOKEN" > ~/.tmp-migrate/vnc-token
  $SSH_CMD "mkdir -p /home/$REMOTE_USER/.secrets"
  $SCP_CMD ~/.tmp-migrate/parse-token "$REMOTE_USER@$NEW_IP:/home/$REMOTE_USER/.secrets/cloudflared-autoparse-token"
  $SCP_CMD ~/.tmp-migrate/vnc-token "$REMOTE_USER@$NEW_IP:/home/$REMOTE_USER/.secrets/cloudflared-vnc-token"
  rm -rf ~/.tmp-migrate

  # ── 阶段九：cloudflared 服务 ─────────────────────────────────────────────
  echo ""
  echo "▶ 阶段九：cloudflared systemd 服务"

  $SSH_CMD "
sudo tee /etc/systemd/system/cloudflared-autoparse.service > /dev/null << 'EOF'
[Unit]
Description=Cloudflare Tunnel for auto-parse ($MACHINE_ID)
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=$REMOTE_USER
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate run --token-file /home/$REMOTE_USER/.secrets/cloudflared-autoparse-token
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/cloudflared-vnc.service > /dev/null << 'EOF'
[Unit]
Description=Cloudflare Tunnel for VNC ($MACHINE_ID)
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=$REMOTE_USER
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate run --token-file /home/$REMOTE_USER/.secrets/cloudflared-vnc-token
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-autoparse cloudflared-vnc
sleep 5
sudo systemctl is-active cloudflared-autoparse cloudflared-vnc
"
  echo "   ✅ CF Tunnel 配置完成"
  echo "   parse tunnel: $TUNNEL_PARSE_ID"
  echo "   vnc tunnel:   $TUNNEL_VNC_ID"
fi

# ── ⏸️ 暂停点 A ────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⏸️  暂停点 A：请用户完成 AdsPower 分身创建"
echo ""
echo "   VNC 地址: https://${VNC_DOMAIN}/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote"
echo ""
echo "   请在 VNC 桌面中："
echo "   1. 登录 AdsPower 账号"
echo "   2. 创建 3 个浏览器分身（代理: http://127.0.0.1:7890）"
echo "   3. 获取 3 个分身的 user_id（格式 k1xxxxx）"
echo ""
echo "   完成后请提供 3 个 user_id，继续执行阶段十"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PAUSE_A:waiting_for_ads_ids"
exit 0  # Agent 会在用户提供 IDs 后调用 migrate-stage2.sh 继续
