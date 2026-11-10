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
