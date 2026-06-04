# Agent 项目接手入口

## 项目定位
`auto-parse` 是 Next.js 全栈自动化平台，包含视频解析/发布、浏览器自动化、工作流、Gemini 网页生图和批量任务。远端运行目录 `/root/auto-parse`，公网入口 `https://parse.vyibc.com`。

## 必读顺序
1. `AGENTS.md`
2. `TASKS.md`
3. 当前任务对应的 `dev-log/*.md`
4. `docs/architecture.md`
5. `docs/development/task-tracking.md`
6. `docs/deployment.md`
7. 相关现有 `docs/*.md`

## 主要目录
- `app/`：Next.js 页面和 API Route。
- `components/`：共享 React 组件。
- `lib/workflow/`：工作流访问、执行引擎、节点和任务持久化。
- `lib/rpa/`：旧 RPA 能力和历史文件，不是正式工作流配置源。
- `lib/parse/`、`lib/analysis/`：解析和分析能力。
- `python/`：使用 `uv` 管理的 Python vendor 和桥接能力。
- `skills/`、`docs/`：技能和长期文档。

## 技术栈与检查
Node.js、Next.js 16、React 19、TypeScript、Tailwind CSS、Playwright、Supabase REST、R2/OSS。

```bash
npm run lint
npx tsc --noEmit --pretty false
npm run build
```

项目当前没有成体系的自动化测试。必须按修改范围执行接口、页面或真实工作流验证。全仓 TypeScript 检查存在遗留错误，不能把失败写成通过。

## 正式工作流事实源
- Supabase `rpa_workflows` 是正式工作流配置唯一事实源。
- 运行时代码不得读取、合并、回退或自动同步 `lib/rpa/workflows/*.json`。
- 本地 JSON 只允许作为历史资料或人工迁移材料。
- 工作流修改必须通过 Supabase 对应接口或管理页面完成并验证。

## 远端开发与部署边界
- 远端：`root@152.32.214.95:/root/auto-parse`。
- 服务：systemd `auto-parse.service`，当前运行 `npm run dev -- -p 1007`。
- 只允许 SSH 登录后在远端审计、手工修改、重启和测试。
- 严禁 `scp`、`rsync`、Git push/pull，严禁把本地项目文件、代码或补丁同步到远端。
- 严禁用本地 checkout 覆盖远端文件；必须保留远端已有未提交修改。
- `deploy/` 下旧 Docker/镜像推送脚本是历史方案，未经负责人批准不得执行。
- 重启：`systemctl restart auto-parse.service`。
- 验证：本机 `http://127.0.0.1:1007`，公网 `https://parse.vyibc.com`。

## Git、任务与安全
- 开始前执行 `git status --short`，不得回退无关修改。
- 禁止 `git reset --hard`、`git checkout -- <file>` 等破坏性操作。
- 未经负责人明确要求不提交；远端验证通过后的及时提交与 `git push` 属于负责人已明确要求。
- 开始、进行和结束任务时维护 `TASKS.md` 与对应 `dev-log`。
- Token、密码、私钥、Cookie 和环境变量值不得写入仓库或日志。
- 不得声称执行了未实际执行的测试、重启、部署或提交。

## 完成前检查
- 修改基于远端真实代码和 Supabase 真实配置。
- 已保护远端原有修改。
- 已执行适用检查并记录结果。
- 影响服务时已重启并验证端口和公网页面。
- 已更新 `TASKS.md` 和对应 `dev-log`。
- 未泄露敏感信息，未使用禁止的同步方式。

## 本地与远端一致性补充规则

- 同一业务任务原则上必须在本地与远端分别实现相同的业务语义，不能只修改一个环境后宣称完成。
- 禁止从本地向远端传输文件或补丁；远端必须 SSH 登录后基于远端真实代码手工实现。
- 两端无法逐字一致时，必须保证行为、接口契约和正式 Supabase 配置一致，并在任务日志记录差异原因。
- 完成前必须分别记录本地与远端涉及文件、Git 状态、检查结果、运行验证和剩余差异。
- 任一环境尚未实现或未验证时，任务必须保持 `In Progress` 或 `Blocked`。
- 远端基于远端真实代码完成修改并验证通过后，必须在远端及时提交并 `git push`；该 push 仅用于保存远端已验证成果，不得用于把本地代码同步到远端。
- AdsPower 执行异常或页面状态不明确时，使用 VNC 观察现场：`https://vnc.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1`。
