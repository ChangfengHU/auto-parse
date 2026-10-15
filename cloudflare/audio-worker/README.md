# Auto-parse Audio Studio

页面 `/audio-library` 与 Cloudflare MCP 共用 `src/core.ts`；只有 `/health` 公开，其余 REST / MCP / 音频文件均要求所有者 Bearer 密钥。

## 能力及真实边界

- Openverse（含 Freesound/Jamendo 索引）与 Wikimedia 检索；只从来源 ID 重新取得元数据，不接收任意下载 URL。
- 私有 R2 文件 + D1 标签、来源、授权、SHA256、实测时长、估算成本和复用次数。
- Cloudflare `elevenlabs/music-v2` 纯音乐生成；本工作室限制 3–120 秒。使用统一 AI 计费，不需要浏览器持有 CF 令牌。
- MiniMax 适配已写，因实测请求结果未确认，默认禁用。不能当作已验证可用。
- 独立音效支持 ElevenLabs API 适配，但没有密钥与计费预留配置时关闭。Freesound/Jamendo 原始文件直连尚未配置；聚合试听文件不冒充原始 WAV。
- 入库前必须人工试听和核对当前用途授权。生成音乐库仅内部使用，不允许因发布 MCP 而公开分发文件。
- 没有自动混音、对口型、配音或视频渲染。

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
