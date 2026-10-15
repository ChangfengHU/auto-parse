# AUDIO-002 音频工作室与 Cloudflare MCP

## 用户目标与范围

- 在现有 /audio-library 页面完成素材搜索、私有库、标签、试听、付费生成、任务状态、验收入库与复用下载。
- 同一业务服务封装 Cloudflare MCP；验收后发布能力广场。广场仅发布工具元数据，不能公开私有资产或凭据。
- 素材库优先；生成必须明确确认费用与预算，并使用幂等请求。生成成功先进入候选区，人工通过后进入正式库。
- 内部复用权限与对外素材分发权限分别保存。ElevenLabs 音乐默认仅内部库，不因付费而自动获得公开素材库权限。
- 不新增视频制作、混音编辑器、社交平台发布功能；不修改其他业务。

## 环境与保护

- 已通过 Vault 指定 SSH 登录 84，远端主机与当前执行环境的 boot ID 一致；唯一源码位于 /opt/auto-parse。
- 初始工作树仅 .materials.json 有既有修改，保持原状。
- 生产为 systemd auto-parse，127.0.0.1:11007，现有独立构建目录；新构建隔离后验收再切换。
- Cloudflare 使用 Vault 指定 forwarding 账号；账户只读身份请求成功。

## 当前进度

- 已核对 Cloudflare 统一目录中的 elevenlabs/music-v2、minimax/music-2.6。旧审计仅检索 Workers AI，不代表 Cloudflare 全部能力；需以新的真实生成结果修正。
- 外部 Freesound/Jamendo/ElevenLabs 音效直连凭据在已列出的金库目录未找到，界面必须明确展示配置与可用性，不能假称成功。
- 页面首要路径：查找 → 试听 → 导入候选 → 填用途/标签/授权 → 确认入库；无合适资产时明确确认预算再生成。
- 验证包括未授权、跨站请求、幂等、防重复计费、预算并发、上游失败、超时未知态、私有媒体访问、真实浏览器流程与移动端布局。

## 实现及当前验收

- 新建 `cloudflare/audio-worker`，官方 MCP SDK、D1、私有 R2 与 Workflows；页面与 11 个 MCP 工具共用业务层。
- D1 `71995b4c-04df-489b-8e3e-ad3a831b14b3`，R2 `auto-parse-audio-private`；账户仍为 forwarding，未改变其他服务。
- 密钥仅保存到 Vault `service:auto-parse-audio` 和 Worker Secret，页面使用独立 HttpOnly/Secure/SameSite 会话。未公开资产桶。
- 生成按 requestId 幂等、D1 原子预算预留、付费步骤不自动重试；下载/索引可重试但不重复生成。未知态保留预算。
- 8/8 单元测试通过：报价、缺配置、参数与费用确认、幂等并发、预算并发、未知结果、SSRF/大小限制、人工验收及复用门禁。
- 实际 CF 检查通过（逐项证据见 `.data/audio-studio-verification/live-results.json`）；MCP initialize、11 tools/list、tools/call 成功。
- 两个稳定测试任务：`d1c96773-0a2f-453c-a219-21eab07fe674` 为音乐生成，`5476ff1a-2a62-4f9d-8527-133bd1967fd7` 为 Freesound 授权导入。不得更换 ID 盲目重跑。
- 音乐 10.032 秒、48 kHz 双声道 MP3，240812 字节；音效 18.991 秒、44.1 kHz 双声道 MP3，496874 字节。R2 原始字节 SHA256、ffprobe、完整 ffmpeg 解码、401 鉴权、206 Range、候选下载门禁全部通过。
- 新生成音乐预留 $0.025。先前 CF API 探针另有 10 秒音乐成功及一次 MiniMax 超时（结果/实际扣费未知），不并入工作室任务账目，也不声称未收费。
- 两份样本保持候选状态，技术播放检查不代替用户的艺术质量/使用授权验收。
- Next 独立构建 `.next-audio-studio-20261015` 成功；完整 TypeScript 与本次范围 ESLint 通过。全仓 lint 既有错误未处理。
- 浏览器初次测试等 networkidle 被应用后台请求影响，改用 DOM 与目标元素状态；本地预发的浏览器 Origin / Sec-Fetch-Site 被生产 CSRF 拒绝（403），不是素材库失败；保留保护不放宽白名单，正式 HTTPS 才作为页面验收目标。
- 已切换 `ops/audio-library-build.env` 并重启 auto-parse，旧构建保留回退。CF Worker 最新部署版本 `d4fc77a6-dafe-4b2c-a421-08d0b1e99760`。

## 未完成

独立音效生成凭据缺失、MiniMax 未验证、Freesound/Jamendo 原始 API 未配置，不能将这些标成已可用。主链实现与发布已交付；完整任务仍保持 In Progress，等待补凭据与线路验证，不再盲目产生付费请求。

## 上线与发布回执

- 正式 HTTPS 页面完成浏览器验收：登录、HttpOnly/Secure/SameSite Cookie、真实候选素材展示、受保护播放、标签保存、人工验收门禁、报价不扣费、任务页、移动端无横向溢出、无 React 异常、CSRF 拒绝及退出后媒体 401。
- 人工检查桌面/手机截图后调整了手机搜索输入框宽度与导航间距；最终独立构建为 `.next-audio-studio-20261015-r2`。旧构建保留用于回退。
- 已通过 Fleet 正式 `/api/hub/capabilities/import` 发布 `mcp:fleet/auto-parse-audio` v0.1.0，11 个工具、完整输入 Schema，仅发布工具元数据和 Vault 认证引用。
- releaseId: `caprel-57a860ee-a563-4fde-ab5d-3a1e0794defe`
- distributionId: `capdist-e0b67677-03bf-4fdc-a1fc-45f082d18536`
- Harness 回执：`received`，`active: true`，时间 `2026-10-15T17:08:06.620Z`；digest `sha256:22c27f6d9f2dfe6092b8e4867e8cb7a39cbd0d7b7d053bc8b09a63293e86d54b`。
- GitHub 已用 Vault 凭据在 84 只读核对身份 ChangfengHU、目标 ChangfengHU/auto-parse 与 push 权限；本任务提交排除 `.materials.json`。
- 最终浏览器 14/14 检查通过，两份真实音频均实际播放推进时钟；CF 实测 25/25，新增超时映射后单元测试 9 项。
- 独立素材搜索补测：Wikimedia rain 5 条、约 1.2 秒；Openverse footsteps 12 条、约 26.5 秒；cinematic 冷查询超过 30 秒。已加公共元数据 5 分钟缓存与明确 504 提示，不将来源超时混淆为付费任务未知态。不能承诺聚合检索始终稳定，用户可切换 Wikimedia。
- 修复后最终线上搜索复测 3/3：Openverse cinematic 12 条（563 ms）、footsteps 12 条（605 ms）、Wikimedia rain 5 条（743 ms）。这是本次响应时间，不代表冷查询保证。
- 最终 CF Worker 部署版本 `22e6334a-465c-4471-8987-668a8967c00f`；页面最终构建 r2，`/audio-library` 与原 `/parse` 均为 HTTP 200，systemd active。
- 实现提交 `c2240ec` 已推送 origin/main。最终工作树仅保留用户原有 `.materials.json` 修改。
- 已删除两份本地音频测试下载副本，R2 原件、SHA256、任务意图、回执和浏览器截图保留；副本可经鉴权从 R2 恢复。11008 预发进程已停止，旧生产构建保留回退。

## MCP 安装与配置补齐

- 用户指出广场安装入口缺命令。核对发现手动发布的 vault-reference 未接入广场已知服务认证，Codex 分页亦没有 mcp add 原生命令。
- 在 Fleet 所属私有仓库的95干净main副本修复：登记本服务原有 Vault accessToken、能力行直达「安装与配置」、独立可复制的 Codex Bash 命令及登记检查；关闭窗口恢复原批量选择。未改音频服务鉴权，不公开文件，不创建新 Token。
- 本仓库补客户端安装/配置/排错/卸载说明，以及只读浏览器/MCP验证脚本 verify-marketplace.mjs。参数依据官方 MCP 文档与本机 CLI 帮助核对，真实密钥不在命令参数或公开说明中。
- Fleet 实现55e4187已推送私有main；26项基础与38项相关安装/鉴权测试通过，候选页面9项通过。扩展Hub回归1502/1507：两项缺历史Flow压缩包夹具、两项旧归属/Token预期已过时，另一个无关云App执行器测试4分钟不退出被终止；不宣称全仓测试通过。
- 真实 MCP initialize、tools/list=11、audio_capabilities 调用成功；没有发起任何付费请求，也没有修改用户客户端全局配置。
- Fleet clean-main 守卫55e4187正式发布并精确读回，45项绑定/settings保留。线上友好域名管理员12项、workers.dev访客9项均通过：安装入口/命令复制、已有服务Token自动填充、DOM遮掩、桌面/手机及真实只读MCP连接。原应用 /audio-library、/parse 均HTTP200。
- 发布回执保留95的 /home/claude/.local/state/audio-mcp-install-20261015-publish/receipt.json；本机浏览器证据在 .data/audio-studio-verification/marketplace-install-admin-fleet.vyibc.com.json 与对应截图。
