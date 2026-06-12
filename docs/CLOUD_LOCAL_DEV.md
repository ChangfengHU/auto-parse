# 云端本地开发环境规范（Cloudflare 标准版）

> 本文为环境 A 的唯一 VNC 初始化标准。  
> 只保留 Cloudflare Tunnel（`cloudflared`）方案，不再使用 localtunnel / auto-domain 做 VNC 入口。

## 环境概况

| 项目 | 值 |
|---|---|
| 机器 | `34.71.195.210` |
| 用户 | `a01020323900` |
| 工作目录 | `/home/a01020323900/code/auto-parse` |
| Dev server | `http://127.0.0.1:3007` |
| 公网入口 | `https://autoparse-dev.chxyka.ccwu.cc` |
| VNC 入口 | `https://vnc-vyibc-test.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote` |

## 架构图（唯一标准链路）

```text
[浏览器用户]
 ├─ https://autoparse-dev.chxyka.ccwu.cc
 │   └─ auto-domain 隧道 → localhost:3007 (Next.js)
 └─ https://vnc-vyibc-test.vyibc.com/vnc.html
     └─ Cloudflare Tunnel (cloudflared-vyibc-vnc-test.service, vyibc.com 账号)
         └─ localhost:1006 (websockify)
             └─ localhost:5900 (x11vnc)
                 └─ localhost:99 (Xvfb + openbox)
                     └─ AdsPower GUI（含 3 个实例分身）
```

## 服务栈

### 1) VNC 本地服务（systemd + system）

| 服务 | 说明 |
|---|---|
| `vnc-xvfb.service` | `Xvfb :99 -screen 0 1440x900x24` |
| `vnc-x11vnc.service` | `x11vnc -display :99 -rfbport 5900` |
| `vnc-websockify.service` | `websockify 1006 127.0.0.1:5900` |
| `cloudflared-vyibc-vnc-test.service` | `cloudflared tunnel run --token-file ...`，Cloudflare 远端 ingress 管理 |

### 2) AdsPower 与代理（user systemd）

| 服务 | 说明 |
|---|---|
| `adspower` | AdsPower 主程序（GUI + 本地 API） |
| `proxy7890` | 代理进程；AdsPower 启动参数固定 `--proxy-server=http://127.0.0.1:7890` |

## 标准初始化流程

> 该流程用于每次新机器/清空后环境恢复，按顺序执行。重复执行不会破坏现有状态。

### 步骤 0：准备

```bash
cd /home/a01020323900/code/auto-parse
npm install
```

### 步骤 1：配置环境变量（不进版本控制）

编辑 `.env.local`：

```bash
# VNC 地址（固定 Cloudflare/vyibc 标准入口）
NEXT_PUBLIC_DEBUG_VNC_URL=https://vnc-vyibc-test.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote

# 显示器/浏览器
DISPLAY=:99
BROWSER_HEADLESS=false
BROWSER_CHANNEL=chrome
```

其他值（Supabase/Gemini/AdsPower/Oss 等）按安全规则单独维护，不写入文档。

### 步骤 2：启动本地 VNC 栈（系统服务）

```bash
sudo systemctl enable --now vnc-xvfb vnc-x11vnc vnc-websockify
sudo systemctl status vnc-xvfb vnc-x11vnc vnc-websockify --no-pager -l
```

### 步骤 3：启动 AdsPower 与代理（用户服务）

```bash
systemctl --user enable --now adspower
systemctl --user enable --now proxy7890
systemctl --user status adspower proxy7890 --no-pager -l
```

### 步骤 4：部署/更新 VNC Cloudflare Tunnel 服务

Cloudflare token 文件要求：

- 文件：`/home/a01020323900/.secrets/cloudflared-vyibc-vnc-test-token`
- 类型：Cloudflare **Tunnel Connector Token**（`cf_...`）
- 文件权限：`600`
- 注意：**不是** Cloudflare API Key（`cfk_...`）

```bash
# 安装/重建 cloudflared noVNC 服务（会校验 token 与本地 1006 可达）
cd /home/a01020323900/code/auto-parse
bash scripts/install-cloudflared-vnc-service.sh

sudo systemctl status cloudflared-vyibc-vnc-test.service --no-pager -l
```

### 步骤 4.1：确认 vyibc.com Tunnel 远端配置

标准 VNC 入口使用 `vyibc.com` 账号下的独立 Cloudflare Tunnel，不通过 Worker 转发，也不跨账号 CNAME 到 `chxyka` tunnel。

Cloudflare 侧必须保持：

```text
Tunnel: auto-parse-vnc-test
Hostname: vnc-vyibc-test.vyibc.com
DNS: vnc-vyibc-test.vyibc.com CNAME 74209781-7a60-4fcc-8666-0eac3df3f14d.cfargotunnel.com proxied
Ingress: vnc-vyibc-test.vyibc.com -> http://127.0.0.1:1006
```

不要改成 `http://34.71.195.210:1006`。`1006` 是本机 noVNC websockify 端口，不需要对公网开放；Cloudflare 通过本机 `cloudflared` 进程回源到 `127.0.0.1:1006`。

脚本会创建/覆盖以下文件（可直接审计）：

- `/etc/systemd/system/cloudflared-vyibc-vnc-test.service`（来自 `ops/cloudflared-vnc.service.example`）

`ops/cloudflared-vnc.yml.example` 只作为远端 ingress 参考，不再由 systemd 服务直接读取。

### 步骤 5：启动 auto-parse 与 Web 隧道（公网）

```bash
cd /home/a01020323900/code/auto-parse
nohup npm run dev -- -p 3007 > /tmp/auto-parse-dev.log 2>&1 &
```

```bash
cd /home/a01020323900/.auto-domain
nohup node agent.js --port=3007 --name=autoparse-dev --server=wss://tunnel-api.chxyka.ccwu.cc \
  > /tmp/auto-parse-tunnel.log 2>&1 &
```

### 步骤 6：首次登录 AdsPower

1. 访问 `https://vnc-vyibc-test.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote`
2. 用 adspower 账号登录（GUI 登录可见）
3. 进入 **设置 → 本地 API** 获取有效的 Open API Token，写入 `.env.local` 的 `ADS_API_KEY`，并确认 `ADS_API_URL` 为 `http://127.0.0.1:20725`
4. 打开每个分身并登录 Gemini，配置 `http://127.0.0.1:7890` 代理
5. 将分身 ID 填入 `ADS_INSTANCE_POOL_IDS`

## 日常启动流程（已初始化机器）

```bash
sudo systemctl is-active vnc-xvfb vnc-x11vnc vnc-websockify cloudflared-vyibc-vnc-test.service
systemctl --user is-active adspower proxy7890
systemctl --user status adspower proxy7890 --no-pager -l

cd /home/a01020323900/code/auto-parse
ss -tlnp | grep -E ":3007|:7890|:20725|:50325|:1006"
```

### 重启后建议顺序

1. `sudo systemctl restart vnc-xvfb vnc-x11vnc vnc-websockify`
2. `systemctl --user restart proxy7890 adspower`
3. `sudo systemctl restart cloudflared-vyibc-vnc-test.service`
4. 重启 dev 与隧道服务（步骤 5）

## 验证清单（可直接复用）

```bash
# 本地 VNC 栈
DISPLAY=:99 xdpyinfo | grep "name of display"
ss -tlnp | grep -E ":5900|:1006"

# VNC 公开链路（Cloudflare）
node scripts/verify-cloudflare-vnc.js https://vnc-vyibc-test.vyibc.com
curl -I https://vnc-vyibc-test.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote

# 后端/API 健康
curl -s http://127.0.0.1:20725/api/v1/browser/list | head -30
curl -s --proxy http://127.0.0.1:7890 --connect-timeout 5 https://www.google.com -o /dev/null -w "%{http_code}"
curl -s http://127.0.0.1:3007/ -o /dev/null -w "%{http_code}"
curl -s https://autoparse-dev.chxyka.ccwu.cc/ -o /dev/null -w "%{http_code}"
```

## 已知问题与解法（只保留当前标准链路）

### 问题 1：VNC 页面黑屏、空白或看不到控制按钮

**常见原因**

- `cloudflared-vyibc-vnc-test.service` 没有正常运行
- `vnc-websockify.service` 或 `vnc-x11vnc.service` 未启动
- `Xvfb :99` 未就绪
- AdsPower 未启动/未在桌面显示

**处理**

```bash
sudo systemctl restart cloudflared-vyibc-vnc-test.service
sudo systemctl restart vnc-websockify.service vnc-x11vnc.service vnc-xvfb.service
systemctl --user restart adspower
```

然后在终端确认：

```bash
journalctl -u cloudflared-vyibc-vnc-test.service -n 80 --no-pager
journalctl -u vnc-websockify.service -n 40 --no-pager
journalctl -u vnc-x11vnc.service -n 40 --no-pager
```

### 问题 2：VNC 连接提示 WebSocket 失败 / `connection is closed`

**常见原因**

- 访问到了错误域名（旧的 loca.lt 或过期地址）
- Cloudflare Tunnel token 过期或被替换
- 本地 websockify 未监听 `:1006`

**处理**

1. 统一检查 URL：`https://vnc-vyibc-test.vyibc.com/vnc.html?...`
2. 本地检查 `ss -tlnp | grep 1006`
3. 重新安装/启动 cloudflared 服务：

```bash
bash scripts/install-cloudflared-vnc-service.sh
node scripts/verify-cloudflare-vnc.js https://vnc-vyibc-test.vyibc.com
```

### 问题 2.1：不要用 Worker 转发或跨账号 CNAME 承载 VNC

**已验证失败方案**

```text
vnc-auto.vyibc.com -> Worker -> vnc-auto.chxyka.ccwu.cc        => 502
vnc-auto-tunnel.vyibc.com CNAME chxyka 账号的 cfargotunnel.com => 1033
```

**原因**：noVNC 需要稳定 WebSocket 升级。Worker 代理 Cloudflare Tunnel 域名、跨账号 CNAME 到另一个账号的 tunnel 都不等价于同账号 public hostname。

**正确做法**：在 `vyibc.com` 所属 Cloudflare 账号下创建独立 Tunnel，connector 运行在本机，回源到 `127.0.0.1:1006`。当前标准域名：

```text
https://vnc-vyibc-test.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote
```

验证：

```bash
node scripts/verify-cloudflare-vnc.js https://vnc-vyibc-test.vyibc.com
```

### 问题 2.2：公网返回 Cloudflare 502，cloudflared 日志里出现公网 IP:1006 超时

**现象**

```text
Unable to reach the origin service ... dial tcp 34.71.195.210:1006: i/o timeout
```

**原因**：Cloudflare Tunnel 远端 ingress 被错误改成 `http://34.71.195.210:1006`。  
`1006` 不应作为公网端口访问，它只需要本机监听。

**处理**：把 Cloudflare Tunnel 远端配置改回 `http://127.0.0.1:1006`，然后重启服务：

```bash
sudo systemctl restart cloudflared-vyibc-vnc-test.service
node scripts/verify-cloudflare-vnc.js https://vnc-vyibc-test.vyibc.com
```

### 问题 3：AdsPower API 认证失败 / Forbidden

**原因**：浏览器未重登或 API Token 非法/过期。

**处理**：在 VNC 内重新登录 AdsPower，再到设置页重新复制 Open API Token，更新 `.env.local`。

### 问题 4：AdsPower 浏览器里出现“无法上网”

**原因**：`proxy7890` 不在运行，但分身仍有 `--proxy-server=http://127.0.0.1:7890`。

**处理**：

```bash
systemctl --user restart proxy7890
ss -tlnp | grep 7890
```

### 问题 5：`vnc_lite.html` 看不到左侧栏

**原因**：`vnc_lite.html` 是精简版。

**处理**：使用 `vnc.html`（标准入口）。

### 问题 6：参考图上传误打开 `Open Files`

**原因**：Gemini 参考图工作流如果使用 `paste_image_clipboard.mode=upload`，会主动点击 Gemini 的上传/Images 入口，可能弹出 SunBrowser 原生 `Open Files` 窗口。该窗口会抢焦点并导致 AdsPower/CDP 页面句柄失效，表现为 `Target page, context or browser has been closed`。

**处理**：已在 `lib/workflow/nodes/paste-image-clipboard.ts` 优化为：
- 进入节点时先清理残留的 SunBrowser `Open Files` 窗口
- `4a163587-6e5e-4176-8178-0915f0429ee0` 运行时由 `lib/workflow/workflow-db.ts` 强制规范化为 `mode=paste`、`uploadFallback=false`
- 不再点击上传/Images/Open files 入口；如果剪贴板粘贴失败，应先修粘贴路径，不要回退到文件选择器路径

## 关键端口

| 端口 | 服务 |
|---|---|
| `3007` | auto-parse dev server |
| `1007` | 历史端口，仅远端常用 |
| `1006` | noVNC websockify |
| `5900` | x11vnc |
| `7890` | 代理 |
| `20725` | AdsPower 内部 API |
| `50325` | AdsPower Open API |
| `10009` | Playwright CDP |

## 关键路径

| 文件 | 作用 |
|---|---|
| `/home/a01020323900/code/auto-parse/.env.local` | 本地环境变量（不入 Git） |
| `/etc/systemd/system/vnc-xvfb.service` | VNC Xvfb |
| `/etc/systemd/system/vnc-x11vnc.service` | VNC x11vnc |
| `/etc/systemd/system/vnc-websockify.service` | WebSocket 桥接 |
| `/etc/systemd/system/cloudflared-vyibc-vnc-test.service` | vyibc.com Cloudflare Tunnel for VNC |
| `/home/a01020323900/.secrets/cloudflared-vyibc-vnc-test-token` | vyibc.com Tunnel connector token（离线保管） |
| `/home/a01020323900/.config/systemd/user/adspower.service` | AdsPower 服务 |
| `/home/a01020323900/.config/systemd/user/proxy7890.service` | 代理服务 |
