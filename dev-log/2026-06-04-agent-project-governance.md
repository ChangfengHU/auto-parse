# GOV-001 Agent 项目治理初始化

- 日期：2026-06-04
- 状态：In Progress
- Owner：codex
- 仓库：`/root/auto-parse`
- 模块：docs / governance
- Commit：pending

## 背景与目标
项目已有 README、接口、工作流、本地开发和旧部署文档，但缺少统一 Agent 接手入口、任务看板、单项日志和维护规则。本任务建立适配真实架构和远端约束的治理体系，不覆盖已有文档。

## 审计结果
- 单仓库 Next.js 16 / React 19 / TypeScript 项目，包含页面、API Route、Playwright/RPA Runtime、Python vendor 和技能文档。
- 远端 `/root/auto-parse`；systemd `auto-parse.service` 实际运行 `npm run dev -- -p 1007`。
- 公网入口 `https://parse.vyibc.com`。
- 正式工作流应以 Supabase 为唯一配置源，仍需继续清理本地 JSON 读取路径。
- 未发现项目自动化测试文件；主要检查是 Lint、TypeScript、真实接口、页面和工作流验证。
- `deploy/` 中旧 Docker、镜像推送和 scp 流程与当前约束冲突，已标记为未经批准禁止执行。
- 初始化前远端已有大量未提交业务修改，本任务未回退或覆盖它们。

## 设计决策与实现
根目录 `AGENTS.md` 是 Agent 必读入口；`TASKS.md` 只保存摘要；详细过程放 `dev-log/`；长期规则和事实放 `docs/`。无法确认的历史任务不标记 Done。

新增 `AGENTS.md`、`TASKS.md`、本日志、`docs/development/task-tracking.md`、`docs/architecture.md` 和 `docs/deployment.md`。仅新增治理文档，没有修改业务代码、环境或工作流配置。

## 验证
- 已验证：治理文件结构、标题、Git 状态、尾随空白与敏感信息扫描正常。
- 已验证：`auto-parse.service` 保持 active，端口 `1007` 正常监听。
- 已验证：本机工作流页面和公网工作流页面均返回 HTTP 200；根页面按既有行为返回 HTTP 307。

## 部署与提交
纯文档任务不需要重启服务。未执行部署、Commit 或 Push。

## 风险与下一步
远端长期运行开发服务器、旧部署文档冲突、缺少测试基线、当前业务修改缺少独立日志。验证已完成；由负责人确认规范后决定是否单独提交治理文件。

## 一致性规则修正

首次初始化只在远端建立治理文件，遗漏了本地治理入口以及“两端目标业务语义必须一致”的强制规则。现已补充：本地和远端分别手工实现、分别验证、禁止文件或 Git 同步、记录两端差异；任一环境未完成时任务不得标记 Done。

## 一致性规则验证结果

- 已确认本地和远端均存在治理入口。
- 已确认两端均包含分别实现、禁止传输、语义一致、分别验证和未完成不得 Done 的规则。
- 已确认远端 `auto-parse.service` 保持 active，内网与公网工作流页面均返回 HTTP 200。
- 当前仅治理语义一致；业务代码仍存在真实差异，`WORKFLOW-001` 和 `RUNTIME-001` 继续保持 In Progress。
