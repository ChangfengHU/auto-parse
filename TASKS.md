# 项目任务看板

详细过程位于 `dev-log/`，规则见 `docs/development/task-tracking.md`。

## In Progress

- [INFRA-001] 统一远端运行和部署方式
  Status: In Progress
  Owner: codex
  Scope: infra / deployment
  Updated: 2026-07-13T04:18:00Z
  Commit: pending
  Log: dev-log/2026-07-13-auto-parse-systemd-ownership.md
  Next: 切换 65 到 production build + systemd 单一进程并验证解析。

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

暂无可在本次审计中确认同时满足实现、验证、提交与必要部署条件的历史任务。
