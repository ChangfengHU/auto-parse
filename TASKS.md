# 项目任务看板

详细过程位于 `dev-log/`，规则见 `docs/development/task-tracking.md`。

## In Progress

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

- [INFRA-001] 统一远端运行和部署方式
  Status: Backlog
  Owner: unassigned
  Scope: infra / deployment
  Updated: 2026-06-04T13:40:00Z
  Commit: pending
  Log: pending
  Next: 决定继续使用开发服务还是切换生产构建，并处理冲突的旧 Docker/scp 文档。

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
