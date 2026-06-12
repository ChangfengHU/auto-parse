# 新机器从零初始化指南

> 本文适用于全新 Linux 云主机（Debian 12 / Ubuntu 22+），从零搭建与旧机器等价的完整运行环境。
> 完成后可通过 `parse.vyibc.com` 提供 Gemini 生图服务。

---

## 一、前置条件

- 云主机：推荐 GCP / 其他可直连 Google 的区域（用于 Gemini 访问）
- 用户名：`a01020323900`（非 root，有 sudo 权限）
- 需要手边准备：所有 `.env.local` 密钥（Supabase / OSS / API Keys）

---

## 二、系统依赖安装

```bash
sudo apt update && sudo apt install -y \
  git curl wget unzip \
  xvfb x11vnc openbox \
  python3 python3-pip \
  websockify novnc \
  libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
  libgbm1 libgtk-3-0 libxss1 libasound2

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb
sudo dpkg -i /tmp/cf.deb
```

---

## 三、代码拉取与依赖安装

```bash
mkdir -p /home/a01020323900/code
cd /home/a01020323900/code
git clone https://github.com/ChangfengHU/auto-parse.git
cd auto-parse
npm install
```

---

## 四、创建 .env.local

`.env.local` 不进 Git，需手动创建：

```bash
cat > /home/a01020323900/code/auto-parse/.env.local << 'EOF'
# Supabase（从旧机器 .env.local 复制）
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# OSS / R2 存储
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_REGION=
OSS_BUCKET=

# API Keys
GEMINI_API_KEY=
XAI_API_KEY=
OPENAI_API_KEY=

# AdsPower（初始化后填写）
ADS_API_URL=http://127.0.0.1:50325
ADS_INSTANCE_POOL_IDS=           # 新建分身后填写，逗号分隔

# 浏览器 / 显示
DISPLAY=:99
BROWSER_HEADLESS=false
BROWSER_CHANNEL=chrome
BROWSER_IDLE_SIMULATION=false
KEEP_BROWSER_OPEN=true

# VNC 公网地址（Cloudflare Tunnel 建好后填写）
NEXT_PUBLIC_DEBUG_VNC_URL=https://vnc-vyibc-test.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote

# Topic Agent（可选）
TOPIC_AGENT_PROVIDER=
TOPIC_AGENT_MODEL=
TOPIC_AGENT_BASE_URL=
EOF
```

---

## 五、VNC 栈 systemd 服务

### 5.1 创建服务文件

```bash
# Xvfb
sudo tee /etc/systemd/system/vnc-xvfb.service << 'EOF'
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

# x11vnc
sudo tee /etc/systemd/system/vnc-x11vnc.service << 'EOF'
[Unit]
Description=VNC x11vnc server on 5900
After=network.target vnc-xvfb.service
Requires=vnc-xvfb.service

[Service]
Type=simple
ExecStart=/usr/bin/x11vnc -display :99 -rfbport 5900 -forever -shared -nopw -listen 127.0.0.1
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

# websockify (noVNC bridge)
sudo tee /etc/systemd/system/vnc-websockify.service << 'EOF'
[Unit]
Description=VNC websockify bridge on 10006
After=network.target vnc-x11vnc.service
Requires=vnc-x11vnc.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/bin/websockify --web /usr/share/novnc/ 10006 127.0.0.1:5900
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
```

### 5.2 启动 VNC 栈

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vnc-xvfb vnc-x11vnc vnc-websockify
sudo systemctl status vnc-xvfb vnc-x11vnc vnc-websockify --no-pager
```

---

## 六、HTTP CONNECT 代理（port 7890）

AdsPower 分身的代理统一走本机 7890 端口，该端口是一个透明 CONNECT 代理：

```bash
mkdir -p /home/a01020323900/.config
cat > /home/a01020323900/.config/simple-proxy.py << 'PYEOF'
#!/usr/bin/env python3
"""HTTP CONNECT proxy on port 7890 — two threads for bidirectional relay"""
import socket, threading, sys

PORT = 7890

def relay(src, dst, done_event):
    try:
        while not done_event.is_set():
            data = src.recv(65536)
            if not data: break
            dst.sendall(data)
    except: pass
    finally:
        done_event.set()
        try: src.shutdown(socket.SHUT_RD)
        except: pass
        try: dst.shutdown(socket.SHUT_WR)
        except: pass

def handle(client):
    try:
        req = b""
        while b"\r\n\r\n" not in req:
            chunk = client.recv(4096)
            if not chunk: return
            req += chunk
        line = req.split(b"\r\n")[0].decode()
        method, target, _ = line.split()
        if method != "CONNECT": return
        host, port = target.rsplit(":", 1)
        server = socket.create_connection((host, int(port)), timeout=15)
        client.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
        done = threading.Event()
        threading.Thread(target=relay, args=(client, server, done), daemon=True).start()
        relay(server, client, done)
    except: pass
    finally:
        try: client.close()
        except: pass

with socket.socket() as s:
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("127.0.0.1", PORT))
    s.listen(64)
    while True:
        c, _ = s.accept()
        threading.Thread(target=handle, args=(c,), daemon=True).start()
PYEOF

# user systemd 服务
mkdir -p /home/a01020323900/.config/systemd/user
cat > /home/a01020323900/.config/systemd/user/proxy7890.service << 'EOF'
[Unit]
Description=Local HTTP CONNECT Proxy on port 7890
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /home/a01020323900/.config/simple-proxy.py
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now proxy7890
systemctl --user status proxy7890 --no-pager
```

> **注意**：此代理是透明转发，不提供翻墙能力。如果新机器无法直连 Google，需在此代理前端配置上游代理或使用具有出境能力的云主机。

---

## 七、AdsPower 安装

```bash
# 下载 AdsPower Global Linux 版（从官网获取最新链接）
wget -O /tmp/adspower.deb "https://version.adspower.net/software/linux-x64-global/AdsPower-Global-6.x.x-x64.deb"
sudo dpkg -i /tmp/adspower.deb
# 或解压 tar.gz 到 /opt/AdsPower Global/

# user systemd 服务（swiftshader 渲染，解决无 GPU 环境问题）
cat > /home/a01020323900/.config/systemd/user/adspower.service << 'EOF'
[Unit]
Description=AdsPower Browser with Display
After=network.target

[Service]
Type=simple
Environment="DISPLAY=:99"
Environment="QT_QPA_PLATFORM=xcb"
ExecStart=/bin/sh -c 'exec "/opt/AdsPower Global/adspower_global" --no-sandbox --disable-gpu --use-gl=swiftshader'
Restart=on-failure
RestartSec=5
TimeoutStartSec=30

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now adspower
```

---

## 八、Cloudflare Tunnel 配置

需要在 Cloudflare 控制台（账号 `2513120790@qq.com`，zone `vyibc.com`）创建两个 tunnel。

### 8.1 VNC Tunnel

1. 登录 [dash.cloudflare.com](https://dash.cloudflare.com) → Zero Trust → Tunnels → Create a tunnel
2. 名称：`auto-parse-vnc-<新机器标识>`
3. 复制 token，保存到：

```bash
mkdir -p /home/a01020323900/.secrets
echo "eyJ..." > /home/a01020323900/.secrets/cloudflared-vnc-token
chmod 600 /home/a01020323900/.secrets/cloudflared-vnc-token
```

4. Public Hostname 配置：

```
vnc-vyibc-test.vyibc.com  →  http://127.0.0.1:10006
```

5. 安装 systemd 服务：

```bash
sudo tee /etc/systemd/system/cloudflared-vnc.service << 'EOF'
[Unit]
Description=Cloudflare Tunnel for VNC
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=a01020323900
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate run --token-file /home/a01020323900/.secrets/cloudflared-vnc-token
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-vnc
```

6. 更新 Cloudflare DNS CNAME（`vnc-vyibc-test.vyibc.com`）指向新 tunnel ID。

### 8.2 auto-parse API Tunnel（parse.vyibc.com）

1. Tunnels → Create → 名称：`autoparse-prod`
2. 保存 token：

```bash
echo "eyJ..." > /home/a01020323900/.secrets/cloudflared-autoparse-token
chmod 600 /home/a01020323900/.secrets/cloudflared-autoparse-token
```

3. Public Hostname：`parse.vyibc.com → http://127.0.0.1:3007`
4. 安装服务：

```bash
sudo tee /etc/systemd/system/cloudflared-autoparse.service << 'EOF'
[Unit]
Description=Cloudflare Tunnel for auto-parse service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=a01020323900
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate run --token-file /home/a01020323900/.secrets/cloudflared-autoparse-token
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-autoparse
```

5. 更新 `parse.vyibc.com` DNS CNAME 指向新 tunnel ID（CF API key 在 `~/.secrets/cloudflare-api-token`）。

---

## 九、AdsPower 首次配置（需 VNC）

> 在 VNC 桌面（`https://vnc-vyibc-test.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote`）里完成。

1. 打开 AdsPower GUI，登录账号
2. **设置 → 本地 API** → 复制 Open API Token，写入 `.env.local`（暂无对应 key，直接写 curl 测试）
3. 创建 3 个浏览器分身，每个分身：
   - 代理：`http://127.0.0.1:7890`
   - 打开 [gemini.google.com](https://gemini.google.com) 并登录 Google 账号
4. 记录 3 个分身 ID（格式如 `k1xxxxx`），填入 `.env.local`：
   ```
   ADS_INSTANCE_POOL_IDS=k1xxxxx,k1yyyyy,k1zzzzz
   ```

---

## 十、启动 auto-parse 服务

```bash
cd /home/a01020323900/code/auto-parse
nohup node node_modules/.bin/next dev -p 3007 >> /tmp/auto-parse.log 2>&1 &
echo $! > /tmp/auto-parse.pid
```

---

## 十一、验证清单

```bash
# VNC 栈
sudo systemctl is-active vnc-xvfb vnc-x11vnc vnc-websockify
ss -tlnp | grep -E "5900|10006"

# AdsPower
systemctl --user is-active adspower proxy7890
curl -s http://local.adspower.net:50325/api/v1/browser/local-active | python3 -m json.tool | grep user_id

# auto-parse API
curl -s http://localhost:3007/ -o /dev/null -w "%{http_code}"

# 公网
curl -s https://parse.vyibc.com/api/gemini-web/image/ads-dispatcher/tasks?limit=1 \
  -H "User-Agent: Mozilla/5.0" | python3 -m json.tool | head -10

# Cloudflare tunnels
sudo systemctl is-active cloudflared-vnc cloudflared-autoparse
```

---

## 十二、日常启动顺序

```bash
# 系统服务（重启后自动启动，手动恢复时）
sudo systemctl restart vnc-xvfb vnc-x11vnc vnc-websockify
sudo systemctl restart cloudflared-vnc cloudflared-autoparse

# 用户服务
systemctl --user restart proxy7890 adspower

# auto-parse
cd /home/a01020323900/code/auto-parse
nohup node node_modules/.bin/next dev -p 3007 >> /tmp/auto-parse.log 2>&1 &
```

---

## 十三、关键路径汇总

| 文件 | 说明 |
|---|---|
| `~/.env.local` 在项目根 | 所有密钥，不进 Git |
| `~/.secrets/cloudflared-vnc-token` | VNC tunnel token |
| `~/.secrets/cloudflared-autoparse-token` | auto-parse tunnel token |
| `~/.secrets/cloudflare-api-token` | CF Global API Key（用于 DNS 操作）|
| `~/.config/simple-proxy.py` | 7890 代理脚本 |
| `/opt/AdsPower Global/` | AdsPower 安装目录 |
| `/tmp/auto-parse.log` | dev server 日志 |

---

## 十四、与旧机器的差异点

| 项目 | 旧机器 | 新机器 |
|---|---|---|
| IP | `34.71.195.210` | 新 IP |
| AdsPower 分身 ID | `k1b908rw / k1d7vjtr / k1d8g5bo` | 重新创建，新 ID |
| CF Tunnel ID (VNC) | `74209781-7a60-4fcc-8666-0eac3df3f14d` | 新建 tunnel |
| CF Tunnel ID (parse) | `a370b4e3-0a8a-412b-b20f-889015eb47c7` | 新建 tunnel |
| Gemini 登录态 | 已登录 | 需重新登录 |
