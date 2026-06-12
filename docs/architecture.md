# 项目架构

## 总览
`auto-parse` 是单仓库 Next.js 全栈应用。页面、API、工作流运行时和浏览器自动化共享 Node.js 进程；部分分析能力通过仓库内 Python 环境调用。

```text
Browser / Agent / Skill
  -> Next.js App Router pages + API Routes
  -> Parse / Publish / Content / Workflow / Playwright runtime
  -> Supabase formal workflow config + R2/OSS assets + Python bridge
```

## 模块边界
- `app/`：页面与 API Route；`app/workflows/` 和 `app/api/workflows/` 是正式工作流管理入口。
- `lib/workflow/workflow-db.ts`：正式工作流配置访问层，应只访问 Supabase。
- `lib/workflow/engine.ts`、`node-runtime.ts`、`nodes/`：执行与节点实现。
- `lib/workflow/task-store*.ts`、`supabase-task-persist.ts`：任务持久化。
- `lib/workflow/gemini-*.ts`：Gemini 生图、批量和调度。
- `lib/rpa/`：旧 RPA 能力，其中 JSON 不是正式配置源。
- `python/`：使用 `uv` 管理的 Python vendor、应用和共享能力。

## 数据、运行事实与风险
- Supabase `rpa_workflows` 是正式工作流配置唯一事实源。
- `.data/`、`.runtime/`、`.publish-history/`、`.task-traces/` 是远端运行数据，不进入 Git。
- R2 和 OSS 用于远程产物；节点需显式配置 provider 并验证 URL 和文件属性。
- `.env.local`、Cookie 和凭证文件不得写入文档或提交。
- 远端 `/root/auto-parse` 由 `auto-parse.service` 管理，命令 `npm run dev -- -p 1007`，公网入口 `https://parse.vyibc.com`。
- 远端是有状态开发运行环境，不能被本地 checkout 覆盖。
- 已知风险：单进程故障隔离有限、长期运行开发服务器、缺少自动化测试、旧本地工作流和旧部署文档干扰事实判断。

## 双环境事实

本地开发目录与远端运行目录是独立工作区，当前提交和未提交内容可能不同。禁止自动传输代码，但每项业务任务完成时必须保证两端目标业务语义和接口契约一致，并记录无法消除的差异。
