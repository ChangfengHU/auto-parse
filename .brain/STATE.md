# auto-parse 当前状态

- 唯一开发工作区：84.8.217.45:/opt/auto-parse。95 已清理工作副本，禁止重新克隆、安装项目依赖或构建。
- WORKFLOW-002 / DOUYIN-PUBLISH 进行中：凭证预检、上传临时目录清理及 douyin_publish 正式工作流节点已实现；发布节点检查上传/内容检测/AI声明，保存单次提交意图，仅接受真实作品ID。84已跑60/60隔离与回归测试，新helper/节点/测试Lint通过；浏览器控件模拟测试不等于线上UI验收。
- 历史真实验证：84 临时浏览器注入同步的 dy 凭证，实际源码节点验证同一账号及上传控件成功；这不等于完整发布工作流通过。
- 生产运行 systemd auto-parse，源码 /opt/auto-parse，回环端口 11007。此轮还未构建或重启，线上未使用新节点。
- Supabase已保存候选douyin-publish-sunlight-20260908，旧douyin-publish和Fleet MCP未切换。临时HTTP工作流多次实际通过账号与上传；AI声明兼容未验收，最新任务上传中退回登录页并超时，不能据此声称95来源登录失效。本轮停止重试，视频未发布、无作品ID；后续先核查已有登录来源，见开发日志。
- 本任务视频恢复地址：https://resource.vyibc.com/sunlight-minute-final-20260906.mp4；SHA-256 ef5e45df9e0f5f446ceffdca7948d4df031711feb8b0bd294dba81bdb289fa5a。
- 原95恢复副本已归并推送至Git（4ad4f43），核对无独有文件/活动引用后删除，约8.1MiB。唯一制作记录仍保留在 task-recovery/video-story-records-20260908（约1.2MiB）；媒体可从已校验R2恢复。
- 机主明确撤销auto-parse本地发布对Fleet调度门禁的依赖；源码已移除三处检查及对应网络helper，不再要求FLEET_NODE_ID。仍使用任务独立浏览器、核验实际账号和上传能力；Fleet自身隔离表未修改。此前Fleet正常恢复在resource-snapshot阻塞是独立运维问题，不再作为本地发布前置条件。
- 全仓 task-store.ts 存在历史类型错误。保留既有 .materials.json 修改；不得绕过工作流直发、不得重复提交未知结果。
