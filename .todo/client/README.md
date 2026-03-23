# 🖥️ 客户端开发待办

## 技术栈

- **框架**: Tauri 2.0 + Rust
- **前端**: React (复用现有组件)
- **自动化**: Playwright (通过 Node sidecar)
- **打包**: tauri-bundler

## 待办任务

### Phase 1: 项目初始化
- [ ] 搭建 Tauri 项目结构
- [ ] 配置 Node.js sidecar
- [ ] 打包 Playwright 运行时

### Phase 2: 核心功能
- [ ] 移植 douyin-publish.ts 到 sidecar
- [ ] 实现 Rust <-> Node IPC 通信
- [ ] 本地 Cookie/指纹 存储

### Phase 3: UI 集成
- [ ] 复用 /publish 页面组件
- [ ] 适配 Tauri invoke API
- [ ] 系统托盘 + 后台运行

### Phase 4: 分发
- [ ] macOS 签名 + 公证
- [ ] Windows 签名
- [ ] 自动更新机制

## 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      Tauri 客户端                           │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │  系统 WebView   │  │  Rust 后端                       │  │
│  │  (React UI)     │◄─►│  - Tauri Commands              │  │
│  │                 │  │  - 系统 API 调用                │  │
│  └─────────────────┘  └──────────────┬──────────────────┘  │
│                                      │ spawn/stdin/stdout  │
│                       ┌──────────────▼──────────────────┐  │
│                       │  Node.js Sidecar                │  │
│                       │  - Playwright 引擎              │  │
│                       │  - RPA 工作流执行器             │  │
│                       │  - 本地浏览器数据管理           │  │
│                       └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 参考资料

- [Tauri Sidecar](https://tauri.app/v1/guides/building/sidecar/)
- [pkg - Node打包工具](https://github.com/vercel/pkg)
