# 独立视频作品中心 MCP

服务名 auto-parse-video-works，端点 https://auto-parse-v2.vyibc.com/api/video-works/mcp，首版0.1.0。
与抖音发布工具分开，使用同一个作品存储和原生公众号视频草稿执行器。接受草稿保存及重新打开核验为完成，不包含公开发表工具。

## 工具
- register_video_work：来源URL、标题、原始正文、标签、AI来源，confirmRecord=true。无平台账号或发布动作。保留原始元数据，异步留存原画质原片；get_video_work查看archive和retentionState。
- backfill_video_work：现有AutoParse taskId，或历史sourceUrl与元数据。已有任务能读取真实回执时关联；只有平台链接时标记reported_not_verified，不伪造已发布状态。
- list_video_works/get_video_work：跨平台查看，包括独立入库且无投递记录的作品；URL和字节哈希归并，旧URL哈希ID仍可查。
- prepare_wechat_video_draft：只传workId即可复用原片、已验证唯一公众号账号和元数据。需缩短时由Agent改写为20字标题/300字正文；不向用户重复索要已有素材，不机械截断。
- create_wechat_video_draft：workId、confirmDraft=true，按需传Agent改写的title/description。使用内容/账号/文案确定稳定请求号，已有同参数草稿跨入口复用。未知保存禁止重试或另换ID。
- get_wechat_video_drafts：按workId查原草稿回执；completed+saveResponseAccepted+nativeEditorReloadVerified才算草稿保存通过。

## 数据与限制
主记录在.data/video-work-center/works，平台投递在deliveries，原片在originals。同一作品原文案不被平台改写覆盖。默认公众号从已验证draft_saved记录唯一推断，或部署配置指定；无唯一账号时不猜测。
原片异步留存最多两路，512MiB上限，下载仅支持已有授权CDN、拒绝重定向；ffprobe确认MP4含视频；校验SHA256、原字节保存，不转码。后台下载中断可对原作品重新登记以继续留存；这不会提交平台发布。
公众号仍受既有100MiB/H264/AAC和3600秒限制。超限明确返回，不自动降低画质。原生草稿流程保持Supabase原件，不重建浏览器、不覆盖登录。
只读页面依用户要求直接查看；MCP使用作品中心专用连接，不接受其他平台凭据。凭据只存受限服务配置和Vault绑定，不能写进Skill、URL、日志。

## 授权与验收
入库/补录与保存草稿分别需要用户任务授权；不得把登记视频当作已经发布。当前所有者明确要求公众号只保存视频草稿，不测试或开发公开发表。

## 2026-11-10 上线与真实核查
独立MCP 0.1.0、主记录、原片留存和页面已上线。138项相关回归通过。已有18条作品，另补录用户原有《Claude火球灭了，女主却睁眼了》，原片SHA256 d2c842221c8f513a4cbe619e6225ce2731509bd54bf504927716612b2cb9b984，原字节留存，未伪造平台回执。
私有视频草稿测试《Clawd交朋友》请求 workdraft-15f568eceaef73529b013c0edf1baa5f26716f04ae1420de：failed/checking_account，未上传、未保存。独立临时页只读确认公众号网页登录页，无当前账号；官方API账号状态不代表网页登录有效。待用户登录后按原请求恢复核查，不更换ID。
Hub登记预览返回hub_connection_binding_unavailable，暂未登记MCP/组成插件。为诊断读取Hub绑定实际秘密值被自动审核拒绝；未继续读取，不得宣称Hub升级完成。独立Skill安装包已发布：https://skill.vyibc.com/install-video-work-center.sh ，SHA256 d0f861dda2bbcb4c20302c9806c2c1e6a29f891c88d1b03e398943a66cb983ea；安装包不包含MCP凭据。既有发布插件仍0.6.1。
运维补录必须以服务用户claude运行CLI，禁止root写台账；本次补录产生的文件所有者已修复，公开列表恢复200。
