# 项目任务看板

详细过程位于 `dev-log/`，规则见 `docs/development/task-tracking.md`。

## In Progress

- [AUDIO-002] 音频工作室闭环、Cloudflare MCP 与能力发布
  Status: In Progress
  Owner: codex
  Updated: 2026-10-15
  Log: dev-log/2026-10-15-audio-studio.md
  Next: 页面、私有 R2、CF 音乐生成、11 个 MCP 工具已上线；Fleet/Harness 发布已 received/active。完成最终保存后，待补独立音效密钥、核对 MiniMax 未知请求及启用原始素材 API；未开放线路不标为可用。

- [RUNTIME-003] 初始化84小红书锁定Python依赖并复测导入凭证
  Status: In Progress
  Owner: codex
  Log: dev-log/2026-09-09-xhs-python-runtime.md
  Next: 生产修复和实际接口验证完成；本地提交保存。仓库核验为公开，运维记录尚未推送。

- [WORKFLOW-002] 抖音凭证预检与正式工作流自动发布
  Status: In Progress
  Owner: codex
  Scope: credential / workflow / publishing
  Updated: 2026-09-08
  Commit: 本轮回执与正式工作流 MCP 接口提交，见同日开发日志
  Log: dev-log/2026-09-08-douyin-workflow-credential.md
  Next: 已发布作品真实回查与基础字段不发布预览通过，正式 API 已切换。继续定位封面弹窗加载超时；原生话题实体选择未实现。原件冻结，仅授权副本 34f421be-f97c-498a-9c80-5214564abd1c 执行，未知结果不得重复发片。

- [API-001] 自建腾讯元宝扫码登录与视频号取流
  Status: In Progress
  Owner: codex
  Scope: backend / frontend / browser runtime / parser
  Updated: 2026-07-23T13:45:00Z
  Commit: pending
  Log: dev-log/2026-07-23-yuanbao-channels-login.md
  Next: 实现受保护扫码页、持久化会话并验证视频号真实取流。

- [GOV-001] 初始化 Agent 项目治理体系
  Status: In Progress
  Owner: codex
  Scope: docs / governance
  Updated: 2026-06-04T13:40:00Z
  Commit: pending
  Log: dev-log/2026-06-04-agent-project-governance.md
  Next: 完成验证并由负责人确认规范。

- [WORKFLOW-001] 正式工作流改为 Supabase 单一配置源
  Status: In Progress
  Owner: codex
  Scope: backend / workflow / frontend
  Updated: 2026-06-04T13:40:00Z
  Commit: pending
  Log: dev-log/2026-06-04-supabase-workflow-source.md
  Next: 在本地与远端分别实现 Supabase 单一配置源语义并分别验证。

- [RUNTIME-001] Gemini 原画质下载节点与 R2 上传回归
  Status: In Progress
  Owner: codex
  Scope: runtime / workflow / storage
  Updated: 2026-06-04T13:40:00Z
  Commit: pending
  Log: dev-log/2026-06-04-gemini-fullsize-r2.md
  Next: 分别验证本地与远端正式工作流的原图大小、R2 地址和失败路径。

## Blocked

- [TEST-001] 建立可重复的自动化回归基线
  Status: Blocked
  Owner: unassigned
  Scope: testing
  Updated: 2026-06-04T13:40:00Z
  Commit: pending
  Log: pending
  Next: 处理现有 TypeScript 错误并确定浏览器测试隔离方式。

## Backlog

- [DOCS-001] 修正文档中的过期路径、端口和事实源描述
  Status: Backlog
  Owner: unassigned
  Scope: docs
  Updated: 2026-06-04T13:40:00Z
  Commit: pending
  Log: pending
  Next: 审计 README、LOCAL_DEV、WORKFLOW_MANAGEMENT 和 API 文档。

## Done

- [AUDIO-001] 音频素材搜索页面与统一检索接口
  Status: Done
  Owner: codex
  Updated: 2026-10-15
  Log: dev-log/2026-10-15-audio-library.md
  Result: 新增背景音乐/音效检索、时长与授权筛选、试听和授权详情；统一 API 已在 84 生产部署，音乐、音效及原解析页回归通过。

- [RUNTIME-004] 发布任务与浏览器维护共享活动锁
  Status: Done
  Owner: codex
  Updated: 2026-10-11
  Log: dev-log/2026-10-11-publication-browser-lock.md
  Result: 84生产已部署；97项回归、类型检查与构建通过；真实预览 prepared=true/published=false，活动锁获取和释放已证实，浏览器PID保留。

- [API-002] 抖音解析兼容行为系统返回的正式视频链接
  Status: Done
  Owner: codex
  Scope: parser / video-content MCP integration
  Updated: 2026-08-29T16:55:00Z
  Commit: `d7941f8`
  Log: dev-log/2026-08-29-douyin-canonical-video-url.md
  Result: 生产节点接受 `/video/<id>`，指定 Codex 自动剪辑视频返回正确标题、ID 和视频流。

- [INFRA-001] 统一 65 远端运行和部署方式
  Status: Done
  Owner: codex
  Scope: infra / deployment
  Updated: 2026-07-13T04:21:00Z
  Commit: `d1b496a`
  Log: dev-log/2026-07-13-auto-parse-systemd-ownership.md
  Result: 清理遗留 SSH 进程，systemd 单一接管 1007，切换 production build，真实抖音解析通过。

## XHS MCP foundation — 2026-09-09

- Production foundation implemented and verified; source committed locally only due public repository. Six-tool Fleet integration and existing95 session refresh passed. See dev-log/2026-09-09-xhs-mcp-foundation.md.
