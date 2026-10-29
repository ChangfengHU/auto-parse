# 公众号网页贴图草稿核对（准备阶段）

此功能只核对已有公众号贴图草稿，不发表。使用登录的84浏览器1和已配置的公众号 MCP。

REA CLI 运行目录为 /opt/auto-parse，调用前通过受控环境注入 WECHAT_MCP_TOKEN、WECHAT_DRAFT_MEDIA_ID 和 WECHAT_WEB_ACCOUNT（公众号 gh_ 原始ID），避免在命令行、源码、日志里填写凭据。执行 node scripts/wechat-rea-prepare.mjs。需要可用的 npm、REA 6.8.0 和 Node 24.22.1；脚本用 npm exec 固定版本，不改变系统 Node。输出 prepared 只表示核对通过。流程会打开独立编辑器核对网页内部编号、标题与发表按钮，不点击发表；不依赖原登录标签页。

正式工作流：公众号网页贴图草稿核对，ID 9a676224-70bd-41d4-9e85-c8d2b83a00c4，输入 mediaId 与 expectedAccount，浏览器实例1。可使用公众号专用 MCP 的 workflow_list、workflow_open_session、workflow_run、workflow_get_session 和 workflow_close_session；会话不会跨重启保留。仅核对，不发表。

匹配使用官方草稿标题、创建时间和可信素材路径；只扫描当前显示页面，数量与贴图总数不符会报 incomplete。歧义、账号不一致或标题超过20个Unicode码点均停止。共享浏览器繁忙时返回忙，勿解除其他任务的锁。微信管理员验证、分页、发布和发布状态查询尚未实现。
