# auto-parse 当前状态

- 唯一开发工作区：84.8.217.45:/opt/auto-parse。95 已清理工作副本，禁止重新克隆、安装项目依赖或构建。
- WORKFLOW-002 / DOUYIN-PUBLISH 进行中：credential_login 增加可选目标账号/创作者上传预检；84 已实跑 21/21 隔离测试，相关 helper、节点及测试 Lint 通过。
- 历史真实验证：84 临时浏览器注入同步的 dy 凭证，实际源码节点验证同一账号及上传控件成功；这不等于完整发布工作流通过。
- 生产运行 systemd auto-parse，源码 /opt/auto-parse，回环端口 11007。此轮还未构建或重启，线上未使用新节点。
- Supabase 正式工作流和 Fleet 发布 MCP 尚未切换；视频未发布、无作品 ID。
- 本任务视频恢复地址：https://resource.vyibc.com/sunlight-minute-final-20260906.mp4；SHA-256 ef5e45df9e0f5f446ceffdca7948d4df031711feb8b0bd294dba81bdb289fa5a。
- 原95未提交成果在本机 task-recovery/auto-parse-95-20260908，仅作恢复备份，归并保存后删除；制作记录在 task-recovery/video-story-records-20260908。详情见开发日志。
- 全仓 task-store.ts 存在历史类型错误。保留既有 .materials.json 修改；不得绕过工作流直发、不得绕过机群隔离、不得重复提交未知结果。
