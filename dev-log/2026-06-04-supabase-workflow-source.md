# WORKFLOW-001 正式工作流改为 Supabase 单一配置源

- 日期：2026-06-04
- 状态：In Progress
- Owner：codex
- 模块：backend / workflow / frontend
- Commit：pending

## 背景与目标
本地工作流 JSON 的读取、回退、合并和自动同步会干扰 Agent 与运行时对正式配置来源的判断。目标是让 Supabase `rpa_workflows` 成为正式工作流唯一事实源。

## 当前事实
- 正式工作流管理入口为 `app/api/workflows/` 和 `app/workflows/`。
- 核心访问层为 `lib/workflow/workflow-db.ts`。
- 远端仍需基于真实代码审计旧 `/api/rpa/workflows`、`/api/rpa/execute` 和本地 JSON 读取路径。
- 禁止用本地 checkout 覆盖远端；修改必须在 SSH 会话内完成。

## 验证计划
- 搜索并清除正式运行路径中的本地工作流读取、回退、写镜像和同步逻辑。
- 确认正式列表和详情接口只返回 Supabase 数据。
- 确认读取正式工作流不会改写 `lib/rpa/workflows/*.json`。
- 验证旧本地接口明确停用或不再参与正式执行。

## 下一步
在远端继续审计和实现，完成后记录实际修改、检查、重启和公网验证结果。

## 远端审计结果

远端 `lib/workflow/workflow-db.ts`、`app/api/workflows` 和旧 `app/api/rpa` 接口仍包含本地工作流读取、回退、同步和 `localOnly` 路径。Supabase 单一事实源改造尚未在远端完成，任务保持 In Progress。
