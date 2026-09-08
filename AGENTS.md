# Agent 项目接手入口

## 当前机主约定（2026-09-08，优先于下方历史环境说明）

- GitHub、Cloudflare、Supabase、R2等操作先查Vault对应配置（未知键先列目录），在实际执行机器用最小只读请求核对身份、目标及所需权限，再执行提交、推送或部署。不得因本机未配置认证就盲试或要求用户提供已有密钥。凭据只在操作进程使用，不写URL、源码、日志或明文缓存；认证、权限、网络和Git分支分歧分别报告，认证成功不保证写入成功。

- 本任务及后续 auto-parse 开发仅在 `84.8.217.45:/opt/auto-parse` 完成。95 只是 SSH 编排入口，不保留工作副本、不安装依赖、不构建；原双环境一致性要求不再适用，不得为满足旧条款重建 95 副本。
- 实况检查：`systemctl show auto-parse -p WorkingDirectory -p ExecStart`。本次核实为 production start、回环端口 11007；入口为 auto-parse-v2.vyibc.com / auto-parse-65.vyibc.com。
- 仍在 SSH 登录后基于远端真实代码最小修改，保护 `.materials.json` 等其他工作；不得覆盖运行目录。验证后的本任务提交立即 push，只用于保存成果，不用于从另一环境覆盖部署。
- 临时依赖、下载和构建中间产物用完清理；R2 文件确认可下载且校验完整后，删除无后续用途的本地副本。运行中的生产依赖及唯一成果不能当临时文件删。
- 95 退役副本已归并到已推送的 Git 历史，84 原 `task-recovery/auto-parse-95-20260908` 恢复目录已核对后删除。通过 Git 恢复源码，禁止继续双副本开发。
- DOUYIN-PUBLISH 必须通过 Supabase 正式工作流执行，Fleet/MCP 仅作入口或登录来源。以真实作品 ID/创建回执验收，未知提交结果不重试。机主2026-09-08明确取消本地发布对Fleet调度门禁的依赖：不得因dispatchHeld、缺少FLEET_NODE_ID或Fleet不可用阻塞本地工作流；保留任务独立浏览器、账号/上传/AI声明/防重复发布检查，不修改Fleet自身隔离机制。
- `.data/douyin-publications` 保存发布意图与回执，不是临时产物；迁移服务必须保全，丢失或未知状态时先人工核对作品，不得换 requestId 盲目重发。它不是跨机器的分布式去重服务。

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

## 开发环境说明

本项目存在两套开发环境，接手前先确认当前在哪台机器上工作：

### 云端本地开发（GCP Linux VM，`34.71.195.210`）

完整规范见 **`docs/CLOUD_LOCAL_DEV.md`**，涵盖：
- VNC 桌面 + AdsPower + 本地代理的启动与验证
- auto-parse dev server（端口 3007）和公网隧道
- 初始化步骤、验证清单、已知问题与解法

快速验证当前环境是否就绪：
```bash
sudo systemctl is-active vnc-xvfb vnc-x11vnc vnc-websockify  # VNC 栈
systemctl --user is-active adspower proxy7890               # AdsPower 和代理
ss -tlnp | grep -E ":3007|:7890|:1006"                      # 关键端口
curl -s http://127.0.0.1:3007/ -o /dev/null -w "%{http_code}" # dev server
```

公网地址：`https://autoparse-dev.chxyka.ccwu.cc`
VNC：`https://vnc-vyibc-test.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote`

### 远端开发（`152.32.214.95`）

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
- 远端：`root@152.32.214.95:/root/auto-parse`（即上方"远端开发"环境）。
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
