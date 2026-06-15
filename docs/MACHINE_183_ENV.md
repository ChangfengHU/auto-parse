# Machine 183 环境说明（34.29.222.183）

## 快速地址汇总

| 用途 | 地址 |
|------|------|
| 🖥️ VNC 远程桌面 | https://vnc-183.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote |
| 🌐 Auto-parse API | https://parse-183.vyibc.com |
| 📊 Dispatcher 监控 | https://parse-183.vyibc.com/ads-dispatcher |
| 📦 Skill 安装命令 | `bash <(curl -fsSL 'https://skill.vyibc.com/install-vyibc-style-images-183.sh?ts=20260614182848')` |

机器 IP：`34.29.222.183`

## 公网服务

| 服务 | URL |
|------|-----|
| auto-parse API | https://parse-183.vyibc.com |
| VNC 远程桌面 | https://vnc-183.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote |

## Skill 安装命令

```bash
bash <(curl -fsSL 'https://skill.vyibc.com/install-vyibc-style-images-183.sh?ts=20260614182848')
```

Skill 名：`vyibc-style-images-183`，默认 API：`https://parse-183.vyibc.com`

## AdsPower 分身

| user_id | 备注 |
|---------|------|
| k1d8g5bo | gemini-ads-test-socks5 |
| k1d7vjtr | gemini-ads-test-socks5 |
| k1b908rw | gemini-ads-test-socks5 |

代理：`http://127.0.0.1:7890`（本机 proxy7890 服务）

**⚠️ 需要完成 Pause Point B**：在 VNC 里分别打开 3 个分身浏览器，访问 gemini.google.com 并登录 Google 账号，否则生图任务会失败。

## Systemd 服务（用户级）

| 服务 | 说明 |
|------|------|
| adspower.service | AdsPower 带桌面运行 |
| auto-parse.service | Next.js 生产服务，端口 3007 |
| proxy7890.service | 本地 HTTP 代理，端口 7890 |
| ads-watchdog.timer | 每 30s 检测 ADS 实例存活，自动 stop+start |

VNC 相关（系统级 root）：vnc-xvfb, vnc-openbox, vnc-x11vnc, vnc-websockify

## Cloudflare Tunnels

| Tunnel 名 | Tunnel ID | 域名 |
|-----------|-----------|------|
| autoparse-183 | 4037e1fb-9b7a-43da-95ea-69d7295d0c29 | parse-183.vyibc.com → localhost:3007 |
| vnc-183 | 50b80a0a-68b5-4fa2-93fd-5c61d5220195 | vnc-183.vyibc.com → localhost:10006 |

Token 文件：`~/.secrets/cloudflared-autoparse-token`、`~/.secrets/cloudflared-vnc-token`

## Build 说明

代码在 `/home/a01020323900/code/auto-parse/`，SSH 操作需 cd 进去再执行 npm：

```bash
PROJ='/home/a01020323900/code/auto-parse'
ssh -i ~/.secrets/new-machine-key a01020323900@34.29.222.183 "sh -c 'cd $PROJ && npm run build 2>&1'"
```

`next.config.ts` 已设置 `typescript.ignoreBuildErrors: true`（规避存量 TS 类型错误）。

## 磁盘

- 总容量：30GB（已通过 parted + resize2fs 扩容）
- Swap：4GB `/swapfile`
