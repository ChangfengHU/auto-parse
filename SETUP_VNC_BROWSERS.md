# VNC + 浏览器可视化配置指南

本文档总结了 auto-parse 项目中所有关于 VNC、Playwright 浏览器、AdsPower 浏览器的配置和改动。

## 架构概览

```
┌─────────────────────────────────┐
│   auto-parse 工作流             │
│ (Playwright / AdsPower 模式)    │
└──────────────┬──────────────────┘
               │
       ┌───────┴────────┐
       │                │
   ┌───▼─────┐    ┌────▼──────┐
   │Playwright│    │ AdsPower  │
   │ 浏览器   │    │  浏览器   │
   └───┬─────┘    └────┬──────┘
       │                │
       └───────┬────────┘
           (Xvfb :99)
               │
       ┌───────┴────────────┐
       │                    │
   ┌───▼───────┐      ┌────▼──────┐
   │  x11vnc   │      │ websockify │
   │  5900     │      │  1006      │
   └───┬───────┘      └────┬───────┘
       │                   │
       └───────┬───────────┘
               │
           ┌───▼──────────────┐
           │  VNC 客户端      │
           │  或浏览器        │
           │ (vnc.html)       │
           └──────────────────┘
```

---

## 1. VNC 栈安装和配置

### 1.1 安装依赖

```bash
sudo apt-get update
sudo apt-get install -y xvfb x11vnc novnc websockify openbox
```

### 1.2 创建 systemd 服务

#### a) Xvfb 虚拟显示服务 (`/etc/systemd/system/vnc-xvfb.service`)

```ini
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
```

#### b) x11vnc 服务 (`/etc/systemd/system/vnc-x11vnc.service`)

```ini
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
```

#### c) openbox 窗口管理器服务 (`/etc/systemd/system/vnc-openbox.service`)

```ini
[Unit]
Description=VNC openbox window manager
After=network.target vnc-xvfb.service
Requires=vnc-xvfb.service

[Service]
Type=simple
Environment="DISPLAY=:99"
ExecStart=/usr/bin/openbox
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

#### d) websockify 服务 (`/etc/systemd/system/vnc-websockify.service`)

```ini
[Unit]
Description=VNC websockify bridge on 1006
After=network.target vnc-x11vnc.service
Requires=vnc-x11vnc.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/bin/websockify --web /usr/share/novnc/ 1006 127.0.0.1:5900
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

### 1.3 启用并启动服务

```bash
sudo systemctl daemon-reload
sudo systemctl enable vnc-xvfb vnc-openbox vnc-x11vnc vnc-websockify
sudo systemctl start vnc-xvfb vnc-openbox vnc-x11vnc vnc-websockify

# 验证
sudo systemctl status vnc-xvfb vnc-x11vnc vnc-websockify --no-pager
ss -tlnp | grep -E '1006|5900'
```

---

## 2. Playwright 浏览器配置

### 2.1 安装 Playwright 依赖

```bash
cd /path/to/auto-parse
npx playwright install-deps chromium
npx playwright install chromium
```

### 2.2 启用可见浏览器

在 `/path/to/auto-parse/.runtime/backend-config.json` 中配置：

```json
{
  "browser": {
    "headless": false
  }
}
```

或通过 API 调用：

```bash
curl -X POST http://127.0.0.1:1007/api/system/backend-config \
  -H "Content-Type: application/json" \
  -d '{"browser":{"headless":false}}'
```

### 2.3 环境变量设置

在 `.env.local` 中：

```bash
NEXT_PUBLIC_DEBUG_VNC_URL=https://parseweb.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote
```

---

## 3. AdsPower 浏览器配置

### 3.1 安装 AdsPower

```bash
# 下载最新版本
cd /tmp
wget https://version.adspower.net/software/linux-x64-global/8.4.3/AdsPower-Global-8.4.3-x64.deb

# 安装依赖
sudo apt-get install -y libsecret-1-0

# 安装 AdsPower
sudo dpkg -i AdsPower-Global-8.4.3-x64.deb
```

### 3.2 创建用户级 systemd 服务

在 `~/.config/systemd/user/adspower.service`：

```ini
[Unit]
Description=AdsPower Browser with Display
After=network.target vnc-xvfb.service

[Service]
Type=simple
Environment="DISPLAY=:99"
Environment="QT_QPA_PLATFORM=offscreen"
Environment="LIBGL_ALWAYS_INDIRECT=1"
Environment="MESA_GL_VERSION_OVERRIDE=4.6"
ExecStart=/bin/sh -c 'exec "/opt/AdsPower Global/adspower_global" --no-sandbox --disable-gpu'
Restart=on-failure
RestartSec=5
TimeoutStartSec=30

[Install]
WantedBy=default.target
```

### 3.3 启用并启动 AdsPower

```bash
systemctl --user daemon-reload
systemctl --user enable adspower.service
systemctl --user start adspower.service

# 验证
systemctl --user status adspower.service --no-pager

# 检查 API 端口
sleep 20
ss -tlnp | grep 50325  # 应该显示监听
```

### 3.4 配置工作流使用 AdsPower

在工作流中设置节点为 **AdsPower 模式**，auto-parse 会自动检测并连接 API 端口。

---

## 4. VNC 访问方式

### 4.1 通过浏览器（noVNC）

**标准版本（带侧边栏）：**
```
http://127.0.0.1:1006/vnc.html?path=websockify&autoconnect=1&reconnect=1
```

**简化版本（无侧边栏）：**
```
http://127.0.0.1:1006/vnc_lite.html?path=websockify&autoconnect=1&reconnect=1
```

### 4.2 通过 VNC 客户端（推荐稳定性）

**本地连接：**
```bash
# 使用 GMSSH 或 SSH 隧道
ssh -L 5901:127.0.0.1:5900 user@server
```

然后用本地 VNC 客户端（RealVNC、TightVNC、TigerVNC 等）连接：
```
127.0.0.1:5901
```

### 4.3 通过 Cloudflare 隧道

如果启用了 Cloudflare 隧道，可通过公网 URL 访问：
```
https://parseweb.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1
```

---

## 5. 工作流使用示例

### 5.1 创建 Playwright 工作流

1. 访问 `http://127.0.0.1:1007/workflows`
2. 新建工作流
3. 添加节点，**不启用 AdsPower 模式**
4. 执行 → 浏览器会出现在虚拟显示 `:99`
5. 通过 VNC 可看到浏览器操作

### 5.2 创建 AdsPower 工作流

1. 访问 `http://127.0.0.1:1007/workflows`
2. 新建工作流
3. 添加节点，**启用 AdsPower 模式**
4. 在"分身 ID"中指定 AdsPower 的浏览器配置 ID
5. 执行 → AdsPower 会启动对应的浏览器实例
6. 通过 VNC 可看到 AdsPower 浏览器操作

---

## 6. 故障排除

### 6.1 VNC 页面一直 loading

**问题：** noVNC 页面连接后一直显示 loading

**解决方案：**
- 改用 VNC 客户端而不是浏览器（更稳定）
- 或清除浏览器缓存：`Ctrl+Shift+Delete`
- 或尝试 `vnc_lite.html` 版本

### 6.2 Playwright 浏览器看不到

**问题：** 工作流执行但虚拟显示上没有浏览器窗口

**检查步骤：**
```bash
# 检查 backend-config 设置
cat ~/.runtime/backend-config.json

# 检查虚拟显示
DISPLAY=:99 xdotool search --onlyvisible --class .

# 检查 Xvfb 是否运行
ps aux | grep Xvfb

# 查看系统日志
journalctl -u vnc-xvfb --no-pager -n 50
```

### 6.3 AdsPower API 无法连接

**问题：** 工作流报错 "AdsPower 分身未激活或不可用"

**检查步骤：**
```bash
# 检查 AdsPower 进程
ps aux | grep adspower

# 检查 API 端口
ss -tlnp | grep 50325

# 检查服务状态
systemctl --user status adspower.service

# 查看用户日志
journalctl --user-unit adspower.service -n 50
```

**常见原因：**
- AdsPower 还未完全初始化（需要 20-30 秒）
- 虚拟显示异常（重启 Xvfb）
- 需要在 AdsPower GUI 中创建分身

### 6.4 虚拟显示异常

```bash
# 重启所有 VNC 服务
sudo systemctl restart vnc-xvfb vnc-openbox vnc-x11vnc vnc-websockify

# 或单独重启 Xvfb
sudo systemctl restart vnc-xvfb
```

---

## 7. 性能优化建议

### 7.1 网络优化

- 使用 VNC 客户端而非浏览器（减少 WebSocket 开销）
- 若带宽有限，降低虚拟显示分辨率：
  ```bash
  # 修改 /etc/systemd/system/vnc-xvfb.service
  ExecStart=/usr/bin/Xvfb :99 -screen 0 1024x768x24
  ```

### 7.2 资源监控

```bash
# 监控进程占用
watch -n 1 'ps aux | grep -E "xvfb|x11vnc|adspower|playwright" | grep -v grep'

# 检查内存
free -h
```

### 7.3 AdsPower 多实例

AdsPower 可管理多个浏览器分身，每个有独立指纹：
1. 在 AdsPower GUI 中创建多个分身
2. 获取各分身的 ID
3. 在工作流中切换不同分身 ID 即可实现多账户操作

---

## 8. 快速参考

| 组件 | 端口 | 状态命令 |
|------|------|--------|
| Xvfb | - | `systemctl status vnc-xvfb` |
| x11vnc | 5900 | `systemctl status vnc-x11vnc` |
| websockify | 1006 | `systemctl status vnc-websockify` |
| auto-parse | 1007 | `curl http://127.0.0.1:1007` |
| AdsPower API | 50325 | `ss -tlnp \| grep 50325` |
| AdsPower GUI | 1006 (via VNC) | `systemctl --user status adspower` |

---

## 9. 文件检查清单

确保以下文件正确配置：

- [ ] `~/.runtime/backend-config.json` — 包含 `"headless": false`
- [ ] `.env.local` — 包含 `NEXT_PUBLIC_DEBUG_VNC_URL`
- [ ] `/etc/systemd/system/vnc-*.service` — 4 个服务文件
- [ ] `~/.config/systemd/user/adspower.service` — AdsPower 用户服务
- [ ] `npm run dev` 已启动 — auto-parse 应用运行中

---

## 10. 一键初始化脚本

如需在新环境快速部署，可使用以下脚本框架：

```bash
#!/bin/bash
set -e

echo "安装 VNC 依赖..."
sudo apt-get update
sudo apt-get install -y xvfb x11vnc novnc websockify openbox

echo "创建 systemd 服务..."
# 复制各个 .service 文件到 /etc/systemd/system/

echo "启动 VNC 栈..."
sudo systemctl daemon-reload
sudo systemctl enable vnc-xvfb vnc-openbox vnc-x11vnc vnc-websockify
sudo systemctl start vnc-xvfb vnc-openbox vnc-x11vnc vnc-websockify

echo "安装 Playwright..."
cd /path/to/auto-parse
npx playwright install-deps chromium
npx playwright install chromium

echo "配置 backend-config..."
mkdir -p .runtime
cat > .runtime/backend-config.json << 'EOF'
{"browser":{"headless":false}}
EOF

echo "✅ 初始化完成！"
echo "访问: http://127.0.0.1:1007/workflows"
echo "VNC: http://127.0.0.1:1006/vnc.html"
```

---

## 更新日期

- **2026-05-03**：初版，包含所有 VNC、Playwright、AdsPower 配置

## 相关文档

- [auto-parse README](./README.md)
- [Playwright 官方文档](https://playwright.dev)
- [AdsPower 官方文档](https://www.adspower.com)
- [noVNC 官方文档](https://novnc.com)
