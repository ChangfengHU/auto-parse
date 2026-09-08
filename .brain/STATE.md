# auto-parse 当前状态

- 唯一开发工作区：84.8.217.45:/opt/auto-parse。95 已清理工作副本，禁止重新克隆、安装项目依赖或构建。
- WORKFLOW-002 / DOUYIN-PUBLISH 进行中：新增显式远程已登录浏览器模式及二进制文件上传；84 正式候选工作流已实际连接 95 browser-3，通过目标账号核验且不注入 Cookie。70/70 回归通过，相关 ESLint 通过；不等于完整上传/发布成功。
- 历史真实验证：84 临时浏览器注入同步的 dy 凭证，实际源码节点验证同一账号及上传控件成功；这不等于完整发布工作流通过。
- 生产运行 systemd auto-parse，源码 /opt/auto-parse，回环端口 11007。此轮还未构建或重启，线上未使用新节点。
- Supabase 候选 douyin-publish-sunlight-20260908 已改为 useExistingBrowser + buffer；旧 douyin-publish、生产构建和 Fleet MCP 未切换。用户扫码后，创作者接口核验成功。远程任务 c534c8d9-5d65-47a1-bb22-2a2badb8d5a2 在文件传入后等待上传时，95 浏览器服务于 2026-09-08 11:08:18 UTC 被停止并重启，导致连接关闭。未执行发布节点、无创建回执；先协调浏览器稳定使用，再复验上传及 AI 声明，不再次迁移 Cookie 或盲目重试未知提交。
- 本任务视频恢复地址：https://resource.vyibc.com/sunlight-minute-final-20260906.mp4；SHA-256 ef5e45df9e0f5f446ceffdca7948d4df031711feb8b0bd294dba81bdb289fa5a。
- 原95恢复副本已归并推送至Git（4ad4f43），核对无独有文件/活动引用后删除，约8.1MiB。唯一制作记录仍保留在 task-recovery/video-story-records-20260908（约1.2MiB）；媒体可从已校验R2恢复。
- 机主明确撤销auto-parse本地发布对Fleet调度门禁的依赖；源码已移除三处检查及对应网络helper，不再要求FLEET_NODE_ID。仍使用任务独立浏览器、核验实际账号和上传能力；Fleet自身隔离表未修改。此前Fleet正常恢复在resource-snapshot阻塞是独立运维问题，不再作为本地发布前置条件。
- 全仓 task-store.ts 存在历史类型错误。保留既有 .materials.json 修改；不得绕过工作流直发、不得重复提交未知结果。
