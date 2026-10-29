# 公众号贴图：准备、网页发表与状态查询

服务端点：https://auto-parse-v2.vyibc.com/api/publish/mcp/wechat
服务版本：0.3.0。复用84机器浏览器1的已登录公众号，不要求官方freepublish权限；网页仍执行微信的管理员验证，不绕过验证。

## MCP调用流程

1. 明确用户已授权公开的具体草稿；只要求制作草稿不能等同公开授权。
2. 使用 workflow_open_session 打开准备流程 9a676224-70bd-41d4-9e85-c8d2b83a00c4，browserInstance=1、confirmBrowserControl=true，vars包含mediaId、expectedAccount（公众号gh_原始ID）。
3. workflow_run：使用打开结果的sessionRevision、稳定requestId、confirmExecution=true。轮询workflow_get_session，取得history中prepared=true、draftFingerprint；完成后workflow_close_session释放浏览器。
4. 调用 wechat_web_publish_draft，传mediaId、expectedAccount、准备返回的expectedFingerprint、稳定requestId、aiGenerated=true、confirmPublish=true。当前只支持已确认AI生成的单篇newspic，标题不超过20个Unicode码点，不支持该工具发表普通文章或群发。
5. 工具异步返回sessionId；每数秒轮询workflow_get_session。它的done仅表示节点执行完，不表示已发表；查看history.output.status。awaiting_admin_scan时返回的截图是当前验证页面，保留原会话给管理员扫描。也可在84浏览器中操作同一任务页面，不新开另一个发表流程。
6. wechat_web_publish_status按expectedAccount与mediaId查询持久账本。submitted仅表示最终HTTP响应成功且微信base_resp.ret=0，不证明公众可见；核对微信后台/最终文章链接后才能报告公开成功。
7. 完成或人工决定停止时关闭原session。会话20分钟空闲过期，轮询刷新空闲期限；会话/浏览器锁不跨服务重启保留。关闭未确定会话后账本保留unknown，须人工对账。

发表流程正式ID：cea6d731-ce15-46d8-95fb-f420ebfacb93，Supabase是唯一配置源。专用工具自动打开这个流程，无需调用方手工拼节点。

输入示例（仅占位，不能直接执行）：

~~~json
{"mediaId":"EXISTING_OFFICIAL_DRAFT_ID","expectedAccount":"gh_0123456789ab","expectedFingerprint":"PREPARATION_SHA256","requestId":"approved-morning-publication-001","aiGenerated":true,"confirmPublish":true}
~~~

## REA CLI

在84机器 /opt/auto-parse 使用 scripts/wechat-rea-prepare.mjs。脚本用REA 6.8.0、隔离Node 24.22.1执行浏览器导航，精确匹配与提交由与MCP相同的模块完成。它不是脱离浏览器的纯HTTP逆向发布器。

凭据通过受控环境注入 WECHAT_MCP_TOKEN、WECHAT_DRAFT_MEDIA_ID、WECHAT_WEB_ACCOUNT；不得写入命令行参数或日志。

- node scripts/wechat-rea-prepare.mjs：只核对并输出draftFingerprint，关闭任务页。
- node scripts/wechat-rea-prepare.mjs --publish：还需 WECHAT_CONFIRM_PUBLISH=true、WECHAT_AI_GENERATED=true、WECHAT_REQUEST_ID、WECHAT_EXPECTED_FINGERPRINT；会修改来源声明并保存草稿，然后请求网页发表。需要管理员时最多等待20分钟；不要终止原进程后重跑。已提交或未知时查询原账本。

两种入口使用同一活动锁与 .data/wechat-web-publications 持久账本，账号+草稿只保留一个发表意图。已有意图即使更换requestId也不再点击；账本需备份，不能当临时文件清理。两个入口不能同时占用同一个浏览器。

## 验证与限制

2026-10-29真实登录页面、准确草稿映射、编辑器核对和管理员验证提示均已跑通；真实测试屏蔽最终发送，不曾公开测试稿。最终提交一次性保护、错误回执与MCP编辑器交接通过自动测试。管理员通过之后的最终真实提交、审核和公众可见性尚未验收，不承诺无人值守直发。

核对使用官方标题、创建时间、可信封面路径，以及编辑器appmsgid；草稿指纹在开始及最终操作前复读，排除微信每次读取都会重签名的顶层预览url；正文、素材顺序、封面及其他字段仍纳入校验。列表支持最多8次懒加载补齐，总数不一致、多匹配、登录账号不符均拒绝；不是无限分页扫描。网页结构、验证类型和提交路径变化会停止，而非猜测点击。

状态未知不换ID重发。工具建议超时120秒，实际运行异步轮询。管理员等待阶段持久账本为submitting，细分的awaiting_admin_scan在原工作流结果中；服务重启后依据账本及微信后台对账。普通工作流done和提交回执都不能代替发表成功证明。
