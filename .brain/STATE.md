# auto-parse 当前状态

## 机主最新纠偏与实测

### 2026-09-08 回执修复与正式服务更新（以下旧阶段记录不代表当前状态）

- 机主原件 `douyin-publish` 冻结；唯一授权副本 `34f421be-f97c-498a-9c80-5214564abd1c` 保留 13 节点，指向 84 browser-2:9223。新入口只为该副本生成字段白名单执行快照，不改原件或另建发布器。
- 作品 `7683141951113219337` 已发布，原任务 `26d43efb-66c1-47bd-8c18-86f038336b86` 经创作者原生作品列表按精确字符串 ID、账号、标题及时间核验。发布账本和 task.publication 已补真实回执；原执行错误历史保留，业务状态为 published。本轮未重复发布。
- 正式 HTTPS `/api/douyin/workflow` 已上线；capabilities/prepare/publish/get_task/reconcile 受已有管理员认证保护。生产 get_task 实测 published，未认证 401。
- 基础预览任务 `8ce83dd2-36c7-40c8-83e8-945fd83773de` 全流程完成：标题、清空后独立描述、两个 # 话题文本、AI声明，未点击发布。话题不是原生话题实体选择。封面图片入口仍 experimental：弹窗加载/完成超时，尚未验收，不宣称可用。
- 当前生产使用 `.next-douyin-release`，由 systemd drop-in 指定 NEXT_BUILD_DIR；旧 `.next` 暂作回滚来源。源码构建成功、62 项本轮定向测试和完整 TypeScript 检查通过。Fleet 入口集成在 linux-clash 项目维护。

### 早前排障快照（已被上述实测更新）

- 当前唯一执行入口是用户已有 `douyin-publish`，13 个原节点保留。Supabase 只改素材为“给小花找太阳”和首页导航 CDP 指向 84 `http://127.0.0.1:9223`；原发布步骤在前半程验证后恢复，未点击发布。此前新增候选不再执行，不代表用户同意替换原工作流。
- 84 browser-2 创作者接口 status_code=0、账号 53017623213、上传控件存在。正式原工作流任务 `6bfd8080-dc7c-4bd0-bf8b-9e092d205269` 通过素材/连接/跳过扫码/上传页导航，在上传节点失去浏览器。
- 直接证据：84 cdpguard 在 2026-09-08 11:58:48 UTC 因两次 DevTools 探测超时主动重启 browser@2；脚本没有任务占用判断。未修守护机制，不能宣称是登录失效或全部发布已通。尚无作品回执。
- 手动 CDP 页面接力不再依赖 AdsPower profileId，手动模式只建任务页并正确清理。72 项回归及相关 ESLint 通过；代码尚未生产构建切换，浏览器配置已写回 Supabase。临时服务已停、.next/dev 96000 KiB 已清理，生产与唯一证据保留。

## 历史阶段（以下候选与 95 路线已被上述当前约定替代）

- 唯一开发工作区：84.8.217.45:/opt/auto-parse。95 已清理工作副本，禁止重新克隆、安装项目依赖或构建。
- WORKFLOW-002 / DOUYIN-PUBLISH 进行中：新增显式远程已登录浏览器模式及二进制文件上传；84 正式候选工作流已实际连接 95 browser-3，通过目标账号核验且不注入 Cookie。70/70 回归通过，相关 ESLint 通过；不等于完整上传/发布成功。
- 历史真实验证：84 临时浏览器注入同步的 dy 凭证，实际源码节点验证同一账号及上传控件成功；这不等于完整发布工作流通过。
- 生产运行 systemd auto-parse，源码 /opt/auto-parse，回环端口 11007。此轮还未构建或重启，线上未使用新节点。
- Supabase 候选 douyin-publish-sunlight-20260908 已改为 useExistingBrowser + buffer；旧 douyin-publish、生产构建和 Fleet MCP 未切换。用户扫码后，创作者接口核验成功。远程任务 c534c8d9-5d65-47a1-bb22-2a2badb8d5a2 在文件传入后等待上传时，95 浏览器服务于 2026-09-08 11:08:18 UTC 被停止并重启，导致连接关闭。未执行发布节点、无创建回执；先协调浏览器稳定使用，再复验上传及 AI 声明，不再次迁移 Cookie 或盲目重试未知提交。
- 本任务视频恢复地址：https://resource.vyibc.com/sunlight-minute-final-20260906.mp4；SHA-256 ef5e45df9e0f5f446ceffdca7948d4df031711feb8b0bd294dba81bdb289fa5a。
- 原95恢复副本已归并推送至Git（4ad4f43），核对无独有文件/活动引用后删除，约8.1MiB。唯一制作记录仍保留在 task-recovery/video-story-records-20260908（约1.2MiB）；媒体可从已校验R2恢复。
- 机主明确撤销auto-parse本地发布对Fleet调度门禁的依赖；源码已移除三处检查及对应网络helper，不再要求FLEET_NODE_ID。仍使用任务独立浏览器、核验实际账号和上传能力；Fleet自身隔离表未修改。此前Fleet正常恢复在resource-snapshot阻塞是独立运维问题，不再作为本地发布前置条件。
- 全仓 task-store.ts 存在历史类型错误。保留既有 .materials.json 修改；不得绕过工作流直发、不得重复提交未知结果。
