---
name: vyibc-reboot-recover
description: 服务器重启后一键恢复运行环境（项目、VNC、AdsPower、自愈修复）。
---

## 用途

用于“机器重启后快速恢复”：

1. 启动/修复 noVNC 访问链路（Xvfb + x11vnc + websockify）
2. 启动/修复 AdsPower（systemd + 分身自动拉起）
3. 启动项目 `auto-parse`（1007 端口）
4. 修复常见问题（`kfmclient` 缺失、VNC URL 误配为 lite）
5. 输出健康检查结果

## 使用

```bash
# 一键恢复
bash skills/vyibc-reboot-recover/scripts/bootstrap.sh

# 仅查看状态
bash skills/vyibc-reboot-recover/scripts/status.sh
```

## 目标地址

- 项目页：`https://parses.vyibc.com/image-generate`
- VNC：`https://parseweb.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote`

