# Auto-parse Audio Studio

页面 `/audio-library` 与 Cloudflare MCP 共用 `src/core.ts`；只有 `/health` 公开，其余 REST / MCP / 音频文件均要求所有者 Bearer 密钥。

## 能力及真实边界

- 当前默认 Wikimedia 检索；2026-10-21 因持续超时暂时停用 Openverse 搜索（显式调用返回 503），保留已有素材和来源导入适配。页面与 MCP 共用 `lib/audio-source-search.ts`，支持常用中文词、时长/授权筛选、分页，8秒上游超时；没有匹配是空列表，不伪装成来源故障。筛选后数量仅为本页匹配数，不是全库总数。
- 只从来源 ID 重新取得元数据，不接收任意下载 URL。Wikimedia 搜索可能包含发音及不相关录音，分类与用途需试听确认。
- 私有 R2 文件 + D1 标签、来源、授权、SHA256、实测时长、估算成本和复用次数。
- Cloudflare `elevenlabs/music-v2` 纯音乐生成；本工作室限制 3–120 秒。使用统一 AI 计费，不需要浏览器持有 CF 令牌。
- MiniMax 适配已写，因实测请求结果未确认，默认禁用。不能当作已验证可用。
- 独立音效支持 ElevenLabs API 适配，但没有密钥与计费预留配置时关闭。Freesound/Jamendo 原始文件直连尚未配置；聚合试听文件不冒充原始 WAV。
- 入库前必须人工试听和核对当前用途授权。生成音乐库仅内部使用，不允许因发布 MCP 而公开分发文件。
- 没有自动混音、对口型、配音或视频渲染。

## MCP 安装与配置

名称：`auto-parse-audio`。这是远程 Streamable HTTP MCP，不需要在客户端部署 Worker 或安装音频模型。

能力广场：https://fleet.vyibc.com/#/hub?view=capabilities 。搜索 `auto-parse-audio`，点击条目上的「安装与配置」，选择 Codex、Claude Code 或 Cursor。Fleet 管理员登录后复用金库内本服务的已有 Token；未登录只提供占位预览。不要使用 CF Token 或金库管理员主 Token。

已安装 Codex CLI 时，在 Bash 中执行：

```bash
read -r -s -p '音频服务 Token（输入不回显）: ' MCP_AUTO_PARSE_AUDIO_TOKEN
printf '\n'
export MCP_AUTO_PARSE_AUDIO_TOKEN
codex mcp add auto-parse-audio --url https://auto-parse-audio.2513120790.workers.dev/mcp --bearer-token-env-var MCP_AUTO_PARSE_AUDIO_TOKEN
codex mcp get auto-parse-audio
codex
```

Token 为 Vault `service:auto-parse-audio` 的 `accessToken` 原值（不含 `Bearer `）。命令只保存环境变量名；在同一终端启动 Codex，新终端需要重新提供环境变量。`mcp get` 只能证明配置已登记；进入 Codex 后用 `/mcp` 检查连接，先调用 `audio_capabilities` 验证，不进行付费生成。

也可将下列内容合并进 Codex 配置（不要覆盖其他 MCP）：

```toml
[mcp_servers.auto-parse-audio]
url = "https://auto-parse-audio.2513120790.workers.dev/mcp"
bearer_token_env_var = "MCP_AUTO_PARSE_AUDIO_TOKEN"
```

其他支持 HTTP MCP 的客户端配置预览：

```json
{
  "mcpServers": {
    "auto-parse-audio": {
      "type": "http",
      "url": "https://auto-parse-audio.2513120790.workers.dev/mcp",
      "headers": {"Authorization": "Bearer <YOUR_AUDIO_SERVICE_TOKEN>"}
    }
  }
}
```

将占位符替换为服务 Token，私密保存，不提交 Git。Cursor 的配置省略 `type`；以广场对应客户端生成的配置为准。本服务没有 OAuth 登录流程，不要用 `codex mcp login` 代替 Token。401 通常表示 Token 缺失/错误或启动客户端的进程没有继承变量。移除 Codex 登记：`codex mcp remove auto-parse-audio`，不会删除云端素材。

命令依据：[OpenAI MCP 文档](https://developers.openai.com/codex/mcp)及本机 `codex mcp add --help` 核对。安装不等于艺术质量验收，也不会自动生成、付费或公开声音库。

## 部署

唯一应用主机：84.8.217.45 `/opt/auto-parse`。Cloudflare 使用金库 `service:cloudflare` 中 forwarding 账户。

```sh
cd /opt/auto-parse/cloudflare/audio-worker
npm ci
npm test
npm run typecheck
npx wrangler deploy --dry-run
```

`scripts/manage.mjs migrate|deploy|secret` 从 stdin 读取凭据，只放进子进程环境。终端必须先关闭回显，不能把凭据作为命令参数、URL 或文件保存。

绑定：`DB`、私有 `AUDIO`、统一 `AI`、持久化 `JOBS`。`worker-configuration.d.ts` 由 `wrangler types` 生成，不手写。

- 必需 Secret：`AUDIO_ACCESS_TOKEN`，对应 Vault `service:auto-parse-audio`。
- 可选 Secret：`ELEVENLABS_API_KEY`；配置外部音效前同时设置 `SFX_COST_USD`（保守单请求预留值，需按所用套餐核实）。
- `DAILY_BUDGET_USD=1.00`，UTC 日预算。只计算生成预留值，不含充值手续费、R2/D1/Workers 费用。
- `MINIMAX_ENABLED=false`。核对旧请求账单、完成单次验证后才可开启。

## 持久化与扣费安全

`requestId` 是任务及 Workflow 的稳定 ID；请求参数哈希不匹配返回 409。同 ID 并发最多创建一条费用预留。D1 单条条件 INSERT 防止并发超预算，最多 3 个运行任务、50 个每日任务。

付费 Workflow 步骤禁用自动重试，并用 D1 状态 CAS 防止重放。已保存的供应商回执只用于下载重试；下载/索引不重新调用模型。超时/崩溃不确定态显示 `needs_review`，预算不自动返还。不得换 ID 重发，不得 restart 一个已扣费 Workflow。

状态：`queued → generating → saving → completed`；异常为 `failed`（导入）或 `needs_review`（付费）。`completed` 只代表候选文件已保存，不代表人工验收通过。

资产：`candidate → approved / rejected`。私有媒体支持 Range；候选可试听但下载复用须 approved。原始文件 SHA256 与来源信息保存，所有音频均受鉴权保护，不配置公开 R2 域名。

## API / MCP

REST：`POST /v1/{operation}`；媒体：`GET /v1/media/{id}`。MCP：`POST /mcp`（官方 SDK Streamable HTTP）。

11 个工具：`audio_capabilities`、`audio_search`、`audio_library`、`audio_get_asset`、`audio_quote`、`audio_generate`、`audio_import`、`audio_jobs`、`audio_update_asset`、`audio_review_asset`、`audio_use_asset`。

推荐顺序：capabilities → library(approved) → search → import 或 quote → 用户确认费用 → generate → jobs → 试听核权 → review_asset → use_asset。

页面只保存 8 小时 HttpOnly / Secure / SameSite=Strict 工作室 Cookie，不保存 CF 或供应商凭据。生成未确认请求暂存 sessionStorage（不含凭据），必须保持原 requestId。

## 验证与能力广场

- `npm test`：SQLite 同语义预算/幂等并发、未确认付费、授权验收门禁、下载大小、SSRF、安全输出。
- `scripts/verify-live.mjs`：真实 CF MCP/REST、一次 10 秒付费音乐、一个来源导入、R2 SHA256、ffprobe/ffmpeg、私有访问与 Range。稳定测试意图保存在应用 `.data/audio-studio-verification/intents.json`，不可删后重跑以免重复付费。
- `scripts/verify-browser.mjs`：隔离 Chromium 桌面/移动端、登录 Cookie、真实文件播放、标签、费用确认门禁、任务、CSRF、退出。
- `scripts/publish-capability.mjs` 默认只读预检。`publish` 才通过 Fleet 正式 import 接口提交工具元数据，并用稳定 publicationKey 幂等。认证只记录 `vault:service:auto-parse-audio#authorization`，不内嵌密钥，也不上传音频。

接口验收不等于艺术质量或法律授权验收；样本默认留在候选区，等待所有者试听。
