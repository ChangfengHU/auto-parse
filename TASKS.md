# 项目任务看板

详细过程位于 `dev-log/`，规则见 `docs/development/task-tracking.md`。

## In Progress

- [WECHAT-GIF-001] 公众号GIF真实验收与状态声明
  Status: In Progress
  Owner: codex
  Updated: 2026-10-30
  Log: dev-log/2026-10-30-wechat-gif.md
  Next: 真实GIF永久上传、原生贴图草稿及编辑器动画已通过，微信返回素材保留全部30帧和原SHA256。测试稿“GIF动效验证（勿发布）”供手机验收；手机与公众页播放、真实发表未验证，不扩大已有结论。


- [WORKFLOW-011] 公众号网页按草稿ID发表
  Status: In Progress
  Owner: codex
  Updated: 2026-10-29
  Log: dev-log/2026-10-29-wechat-web-publish.md
  Next: MCP0.3.0和REA CLI已接入共享网页发表模块：草稿指纹、来源声明、单次提交、防重账本、管理员扫码交接和状态查询；真实页面已验证到扫码，最终真实公开发表尚待用户指定可公开草稿及管理员操作。82项测试、类型/Lint、构建和生产准备/拒绝错误指纹通过。Hub插件/Skill0.3.6已登记；不把网页submitted等同公开成功。



- [API-003] 公众号官方接口草稿箱与平台MCP
  Status: In Progress
  Owner: codex
  Updated: 2026-10-29
  Log: dev-log/2026-10-29-wechat-drafts.md
  Next: 显式代理修复已上线；43项回归/类型/Lint/构建通过，文章草稿已真实创建并回读，稳定请求重放不重复。同一MCP已补齐newspic并上线；早报8图真实创建、官方类型/顺序/首图封面回读、同请求防重及原生贴图页签可见通过。50项回归/类型/Lint/构建通过，Hub插件0.3.2已登记；原生预览遇验证码、网页公开发表、GIF/Live未验收。当前P0/P1/P2优化进行中；永久GIF放行、HTTP错误状态与图片序号、建议超时已上线并通过52项回归、构建和生产只读验收；独立删除/官方发表接口及查状态、可选归一回读、标题约束和本地正文提额已上线；57项回归通过，测试草稿真实删除并回读不存在。1400字测试被45166拒绝，原因及真实上限未确定；账号官方发表权限48001，浏览器发表及GIF实际播放仍待验证。出口探测、永久素材按内容去重与诊断字段已部署且真实验收；0.2.1附加Live封面链接仅存本地账本，真实临时草稿验证后删除；61项测试/构建通过并部署，Hub插件0.3.4已登记。


- [WORKFLOW-006] X 文字发推工作流与安全预览
  Status: In Progress
  Owner: codex
  Updated: 2026-10-26
  Log: dev-log/2026-10-26-x-publish.md
  Next: X文字工作流、MCP状态查询和多行工作台已上线；151项回归、类型/构建、公网实际点击预览通过。实发及公开可见性待用户指定正式内容后验收。

- [RUNTIME-005] 原画质视频512MiB磁盘分块上传
  Status: In Progress
  Owner: codex
  Updated: 2026-10-26
  Log: dev-log/2026-10-26-original-video-upload.md
  Next: 512MiB磁盘分块修复已上线；100项回归+6项磁盘生命周期、类型、构建、512MiB全链路校验通过。V5真实作品7700832043915119881已创建登记（89MB上传72719ms），审核未确认；本地提交保存，GitHub推送仍待明确授权。

- [AUDIO-003] 音频搜索稳定性与页面/MCP完整回归
  Status: In Progress
  Owner: codex
  Updated: 2026-10-21
  Log: dev-log/2026-10-21-audio-reliability.md
  Next: 搜索修复已上线，18项单元与39项公网回归通过；11工具按只读/安全重放/错误路径逐个调用。待凭据轮换确认，以及新生成/导入/真实写入的专项验收，不把隔离库成功路径冒充线上全闭环。

- [WORKFLOW-005] 小红书与抖音新增图文工作流
  Status: In Progress
  Owner: codex
  Updated: 2026-10-18
  Log: dev-log/2026-10-18-image-text-workflows.md
  Next: 两个六节点图文工作流、MCP节点及工作台已上线；202项回归和两平台真实浏览器非发布测试通过，原有三个视频定义未改。仅剩用户提供正式图文并授权后做公开发布/回执验收；尚不标记实发已验证。

- [AUDIO-002] 音频工作室闭环、Cloudflare MCP 与能力发布
  Status: In Progress
  Owner: codex
  Updated: 2026-10-15
  Log: dev-log/2026-10-15-audio-studio.md
  Next: 页面、私有 R2、CF 音乐生成、11 个 MCP 工具及广场安装/配置已上线；Fleet/Harness 发布已 received/active。待补独立音效密钥、核对 MiniMax 未知请求及启用原始素材 API；未开放线路不标为可用。

- [RUNTIME-003] 初始化84小红书锁定Python依赖并复测导入凭证
  Status: In Progress
  Owner: codex
  Log: dev-log/2026-09-09-xhs-python-runtime.md
  Next: 生产修复和实际接口验证完成；本地提交保存。仓库核验为公开，运维记录尚未推送。

- [WORKFLOW-002] 抖音凭证预检与正式工作流自动发布
  Status: In Progress
  Owner: codex
  Scope: credential / workflow / publishing
  Updated: 2026-09-08
  Commit: 本轮回执与正式工作流 MCP 接口提交，见同日开发日志
  Log: dev-log/2026-09-08-douyin-workflow-credential.md
  Next: 已发布作品真实回查与基础字段不发布预览通过，正式 API 已切换。继续定位封面弹窗加载超时；原生话题实体选择未实现。原件冻结，仅授权副本 34f421be-f97c-498a-9c80-5214564abd1c 执行，未知结果不得重复发片。

- [API-001] 自建腾讯元宝扫码登录与视频号取流
  Status: In Progress
  Owner: codex
  Scope: backend / frontend / browser runtime / parser
  Updated: 2026-07-23T13:45:00Z
  Commit: pending
  Log: dev-log/2026-07-23-yuanbao-channels-login.md
  Next: 实现受保护扫码页、持久化会话并验证视频号真实取流。

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

- [WECHAT-FORMATS-002] 公众号格式、GIF位置和视频播客草稿实测指南
  Status: Done
  Owner: codex
  Updated: 2026-10-30
  Log: dev-log/2026-10-30-wechat-format-usage.md
  Result: 首图/第二张贴图GIF后台动效、图文微信GIF引用与静态显示、视频/播客网页草稿保存及重新打开已实测；52项回归、4个示例结构校验通过。8文件Skill与插件0.3.8已发布且19项固定包逐源核对；MCP仍0.3.1，音视频专用创建工具未封装，公开发表和手机动效不算验收通过。


- [WORKFLOW-010] 公众号草稿MCP验收与插件补丁发布
  Status: Done
  Owner: codex
  Updated: 2026-10-29
  Log: dev-log/2026-10-29-wechat-hub-release.md
  Result: 沿用公众号7工具与4平台插件，Skill/插件0.3.1已发布；固定包校验、Hub回执及隔离原生安装通过，无新业务草稿。

- [RUNTIME-006] 小红书分析页扫码登录与读取恢复
  Status: Done
  Owner: codex
  Updated: 2026-10-28
  Log: dev-log/2026-10-28-xhs-qr-login.md
  Result: 官方网页扫码与停止轮询修复已上线；已复用浏览器2会话，页面展示热门笔记；54项回归、构建/类型与重启后读取通过。



- [WORKFLOW-009] 自动发布插件按自媒体平台分域
  Status: Done
  Owner: codex
  Updated: 2026-10-28
  Log: dev-log/2026-10-28-platform-publication-mcp.md
  Result: 三个平台独立端点/认证/会话隔离已部署；110项回归、真实拒绝检查、新版0.2.0固定包与原生隔离安装通过。



- [WORKFLOW-008] 自动发布插件与能力广场入驻
  Status: Done
  Owner: codex
  Updated: 2026-10-27
  Log: dev-log/2026-10-27-auto-publish-plugin.md
  Result: 两MCP+统一Skill固定插件已入驻；Codex隔离安装与只读公网业务验证通过，详见日志。



- [WORKFLOW-007] X 单图发推与真实回执
  Status: Done
  Owner: codex
  Updated: 2026-10-27
  Log: dev-log/2026-10-27-x-image-publish.md
  Result: 单图原生上传、媒体回执及独立链接回查通过；部署同一验收构建，生产重启后状态查询通过。


- [WORKFLOW-004] 小红书浏览器一键发布与条件节点
  Status: Done
  Owner: codex
  Updated: 2026-10-17
  Commit: 9d54356（已推送 main）
  Log: dev-log/2026-10-17-xhs-one-click-publish.md
  Result: directPublish 分支与真实浏览器工作台入口已上线；浏览器1实际发布作品6ad37843000000001301bb1b并在已发布分页回查。实测回执格式差异已修复并核对落库，无重复发布；167项回归及构建/类型检查通过，原抖音工作流不变。

- [WORKFLOW-003] Workflow authoring MCP and shared runtime correctness
  Status: Done
  Owner: codex
  Updated: 2026-10-17
  Log: dev-log/2026-10-17-workflow-authoring-mcp.md
  Result: 84生产/MCP专用Vault配置上线；131项回归与构建/类型检查通过。浏览器1实传视频一次、暂存草稿并经新MCP会话5步回查通过；保存9节点工作流，无公开发布。修复共享维护锁及封闭组件按钮定位。当前浏览器MP4解码不支持，本地草稿不能当云端发布回执。

- [AUDIO-001] 音频素材搜索页面与统一检索接口
  Status: Done
  Owner: codex
  Updated: 2026-10-15
  Log: dev-log/2026-10-15-audio-library.md
  Result: 新增背景音乐/音效检索、时长与授权筛选、试听和授权详情；统一 API 已在 84 生产部署，音乐、音效及原解析页回归通过。

- [RUNTIME-004] 发布任务与浏览器维护共享活动锁
  Status: Done
  Owner: codex
  Updated: 2026-10-11
  Log: dev-log/2026-10-11-publication-browser-lock.md
  Result: 84生产已部署；97项回归、类型检查与构建通过；真实预览 prepared=true/published=false，活动锁获取和释放已证实，浏览器PID保留。

- [API-002] 抖音解析兼容行为系统返回的正式视频链接
  Status: Done
  Owner: codex
  Scope: parser / video-content MCP integration
  Updated: 2026-08-29T16:55:00Z
  Commit: `d7941f8`
  Log: dev-log/2026-08-29-douyin-canonical-video-url.md
  Result: 生产节点接受 `/video/<id>`，指定 Codex 自动剪辑视频返回正确标题、ID 和视频流。

- [INFRA-001] 统一 65 远端运行和部署方式
  Status: Done
  Owner: codex
  Scope: infra / deployment
  Updated: 2026-07-13T04:21:00Z
  Commit: `d1b496a`
  Log: dev-log/2026-07-13-auto-parse-systemd-ownership.md
  Result: 清理遗留 SSH 进程，systemd 单一接管 1007，切换 production build，真实抖音解析通过。

## XHS MCP foundation — 2026-09-09

- Production foundation implemented and verified; source committed locally only due public repository. Six-tool Fleet integration and existing95 session refresh passed. See dev-log/2026-09-09-xhs-mcp-foundation.md.


## WECHAT-MEDIA-003 — Done
Dedicated video/podcast draft MCP tools with durable request ledger, native browser save/readback, formal Supabase workflow, acceptance tests and Hub/Skill release. Owner: Codex. Completed 2026-10-30: MCP 0.4.0 / 24 tools; real video 100001421 and podcast 100001413 saved/reloaded, idempotency and restart receipts verified. No public test publication.
