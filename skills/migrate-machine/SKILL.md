---
name: migrate-machine
description: |
  将 auto-parse 生图服务迁移/复制到一台新的 Linux 机器上。
  输入 SSH 地址和机器 ID（如 IP 末段），全自动完成环境搭建、服务部署、CF Tunnel 配置、
  skill 发布，在需要人工操作的节点（AdsPower 登录、Gemini 登录）暂停等待用户确认后继续。
  当用户说"迁移到新机器"、"新机器部署"、"备份机器"、"新增一台生图机器"等需求时使用。
---

## 核心能力

- **全自动化**：磁盘扩容、依赖安装、代码克隆、.env 复制、systemd 服务配置、CF Tunnel 创建、DNS 配置
- **两个人工暂停点**：AdsPower 分身创建（Pause A）、Gemini 账号登录（Pause B）
- **隔离命名**：域名、skill 名均以机器 ID（IP 末段）为后缀，多台机器互不干扰
- **经验沉淀**：内置踩坑修复（磁盘扩容、CF API 认证、AdsPower tar 安装、IPv6 tunnel 兼容）

## 使用方式

```
迁移到新机器 34.29.222.200，SSH key 在 ~/.secrets/new-machine-key

把 auto-parse 部署到 34.29.222.220

新增一台备份生图机器，IP 是 1.2.3.4
```

## 执行前提条件

1. 新机器已开机，SSH 可登录（key 已写入 `~/.secrets/new-machine-key` 或用户指定路径）
2. `~/.secrets/cloudflare-api-token` 存在且有效（需 Zone:Edit + Tunnel:Edit 权限）
3. `~/.secrets/cf-account-email` 和 `~/.secrets/cf-account-id` 存在（或能从 CF API 查到）
4. 当前机器 `.env.local` 完整（用于复制到新机器）
5. AdsPower 账号可登录（Pause A 时用户需在 VNC 里操作）
6. Google 账号可登录 Gemini（Pause B 时用户需在 VNC 里操作）

## 执行流程

```
阶段一   磁盘检查与扩容（parted + resize2fs）+ Swap 4GB
阶段二   系统依赖（git curl node20 cloudflared xvfb x11vnc openbox websockify）
阶段三   代码 clone + npm install + playwright chromium
阶段四   复制 .env.local（ADS_INSTANCE_POOL_IDS 留空，VNC URL 替换为新域名）
阶段五   VNC 栈 systemd 服务（xvfb/openbox/x11vnc/websockify）
阶段六   HTTP CONNECT 代理 port 7890
阶段七   AdsPower 安装（tar 从当前机器复制，不依赖官网下载）
阶段八   CF Tunnel 创建（parse-{ID} + vnc-{ID}）+ DNS CNAME
阶段九   cloudflared systemd 服务（系统级）
          ⏸️ 暂停点 A：VNC 公网可用，等用户创建 3 个 ADS 分身
阶段十   填写 ADS_INSTANCE_POOL_IDS
阶段十一 ads-watchdog systemd timer
阶段十二 next build + auto-parse systemd 服务（端口 3007）
          ⏸️ 暂停点 B：等用户在 VNC 里登录 3 个分身的 Gemini
阶段十三 端到端验证（提交 1 张图任务，等待 success）
阶段十四 发布 vyibc-style-images-{ID} skill
阶段十五 输出汇总地址 + 写入 docs/MACHINE_{ID}_ENV.md
```

## 关键参数

| 参数 | 来源 | 示例 |
|------|------|------|
| `NEW_IP` | 用户输入 | `34.29.222.183` |
| `MACHINE_ID` | IP 末段（自动提取）| `183` |
| `SSH_KEY` | `~/.secrets/new-machine-key`（默认）| 可用户指定 |
| `CF_KEY` | `~/.secrets/cloudflare-api-token` | — |
| `CF_EMAIL` | `~/.secrets/cf-account-email` | — |
| `CF_ACCOUNT` | `~/.secrets/cf-account-id` | — |
| `DOMAIN_BASE` | `vyibc.com`（默认）| 可用户指定 |

## 命名规则

- parse 域名：`parse-{MACHINE_ID}.{DOMAIN_BASE}`
- VNC 域名：`vnc-{MACHINE_ID}.{DOMAIN_BASE}`
- Skill 名：`vyibc-style-images-{MACHINE_ID}`
- CF Tunnel：`autoparse-{MACHINE_ID}` / `vnc-{MACHINE_ID}`

## 常见坑（已内置修复）

见 `experience/` 目录：

| 坑 | 文件 |
|----|------|
| CF API 认证头错误（Global Key 用 X-Auth-Key，不是 Bearer）| `experience/cloudflare-api.md` |
| 新机器磁盘未挂载/分区未扩展 | `experience/linux-disk.md` |
| AdsPower 官网 deb 下载失效 → tar 从旧机器复制 | `experience/adspower.md` |
| browser/active 接口缓存坑 → 用 local-active | `experience/adspower.md` |
| next build TypeScript 存量错误 → ignoreBuildErrors | skill 脚本内置 |
| CF Tunnel ingress 用 127.0.0.1:PORT 避免 IPv6 问题 | skill 脚本内置 |

## 输出

迁移完成后输出并保存到 `docs/MACHINE_{ID}_ENV.md`：

```
🖥️ VNC 远程桌面:  https://vnc-{ID}.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote
🌐 Auto-parse API: https://parse-{ID}.vyibc.com
📊 Dispatcher:     https://parse-{ID}.vyibc.com/ads-dispatcher
📦 Skill 安装:     bash <(curl -fsSL 'https://skill.vyibc.com/install-vyibc-style-images-{ID}.sh')
```
