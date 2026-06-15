# experience/ — 踩坑与经验记录

这个目录记录在开发和运维过程中踩过的坑、非直觉的系统行为、以及解决方案。
**AI Agent 接手任务前必读**，避免重蹈覆辙。

## 文件列表

| 文件 | 内容 |
|------|------|
| [cloudflare-api.md](cloudflare-api.md) | CF API Key 认证格式（Global Key vs API Token）、Tunnel 纯 API 创建流程 |
| [adspower.md](adspower.md) | AdsPower 端口说明、browser/active 缓存坑、浏览器重启标准操作、安装方法 |
| [linux-disk.md](linux-disk.md) | 云主机磁盘在线扩容、Swap 创建 |
| [playwright-headless-leak.md](playwright-headless-leak.md) | ⚠️ 天坑：chrome-headless-shell 孤儿进程堆积 → 内存/swap 耗尽 → 生图超时，根因与修复 |

## 使用原则

- 遇到错误前，先查本目录有无相关经验
- 解决了新问题后，**把经验补充到对应文件**（或新建文件）
- 不要依赖 AI 的"猜测"——遇到认证/API 问题先查文档和本目录
