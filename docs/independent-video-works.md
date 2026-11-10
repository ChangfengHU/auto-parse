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

## 网页草稿操作（0.1.1）
卡片与详情新增“存到公众号草稿”，直接复用原片、默认公众号和文案。新接口 /api/video-works/[id]/wechat-draft 只接收确认、标题、正文；调用与MCP相同的prepare/create/status服务，不提供发布参数、替换来源或切换目标账号。匿名与抖音范围连接不可操作，受限网页会话也不能调用旧平台准备接口。
通过已认证MCP create_web_access(confirmWebAccess=true)签发仅一次10分钟入口，兑换最长8小时HttpOnly/Secure/SameSite=Strict cookie。入口片段在兑换前从地址栏移除，服务只存随机码摘要，不把任何后台服务凭据传给浏览器。入口只交给已授权所有者，不写日志。可退出操作，直接浏览不受影响。页面每5秒只查询处理中任务，失败和未知停止重建；保存响应及原生编辑器回读才显示成功。字数超限要求调整文案，不机械截断，不压缩原片。
发布记录auto-parse-work-web-v011b-20261110，源码de8824b；17项相关隔离回归、针对性TypeScript、ESLint及生产构建通过。真实页面复用旧草稿100001831，无新增投递；查看Clawd原失败记录，不重试。手机390px检查并修复操作区位置，Escape关闭和恢复桌面验证通过。临时viewport已重置，页面留给用户，当前浏览器已启用8小时操作会话。
网页退出公众号登录导致新建草稿仍未验收；自动审核拒绝再次点击该失败作品保存按钮，未绕过，改为只读查看。需用户登录后继续。Hub独立MCP连接及主插件升级仍未完成；Skill安装包0.1.1已发布，SHA256 a44714d9a59e66de75bd22c803bd4c5d8c562535e9e3ff186b39e71e4af2ad56，不表示客户端已自动安装。

## 无网页登录的官方视频API探测（2026-11-10）
固定目标探测脚本scripts/probe-wechat-api-video-type.mjs，不提供生产通用API代理，不改变原HTML校验。article_type=video被微信回读为news；真实4MB视频永久素材上传成功，但通过draft/update写入的标准video元素及源地址在draft/get时被移除。官方MCP独立回读及列表确认仅1条《API视频验证未通过勿发布》测试图文；不是有效视频草稿。未创建第二条假视频稿、未发表。此结果只覆盖已测试的公开API路线，不等于穷尽所有嵌入方式或未公开接口。现有页面与MCP仍使用原生视频浏览器路线，需要对应公众号网页登录。2条有效视频草稿双入口验收未完成。

## 2026-11-10 双入口真实视频草稿验收（UTC 17:50–17:54）
本节替代前文“等待登录/新建未验收”的当前结论；历史失败记录仍保留。84浏览器1只读检查确认已登录gh_8dfb3900381c（唯伊不可）。复用Supabase工作流a5844b00-cd7b-442d-9e4f-8a5a18338b82《公众号视频与播客草稿》，测试前后updatedAt均为2026-10-30T07:40:55.645+00:00，未复制或修改原件，不改抖音流程。

- 实际已安装公众号MCP调用：标题“视频草稿MCP验收1110”，requestId=wechat-workflow-mcp-e2e-20261110-01，appMsgId=100002163，mediaIdentity=wxv_4777156190361272321，verifiedAt=2026-11-10T17:50:35.958Z。官方草稿mediaId=3UL3H6nAAGfSe70jlkoNLCes-ZCsi2pTB_gKIs6trf8SW8Sr-vxbK7oEmDHLIcUK。
- 实际作品中心页面点击保存：标题“视频草稿页面验收1110”，requestId=workdraft-70db587a53eaddbf79f6a46af4a28ec466e4b0ddf1ba7e37，appMsgId=100002168，mediaIdentity=wxv_4777160164632117249，verifiedAt=2026-11-10T17:54:18.146Z。官方草稿mediaId=3UL3H6nAAGfSe70jlkoNLH8PxbeUR0KkTAE7EHr5z7kjD0i3OQ7TidXKPJs0HRFX。
- 两次均completed，saveResponseAccepted/titleVerified/descriptionVerified/nativeEditorReloadVerified=true；原片4,198,703字节、64.922993秒，未压缩；published=false，playbackVerified=false。通过原生编辑器回读核对视频标识，不将官方API返回news类型视为播放器证据。
- 官方MCP列表独立读到两个新标题和不同mediaId；另有旧“API视频验证未通过勿发布”探测图文，总计3条，本次有效新增视频草稿为2条。未删除旧探测稿，未公开发表。
- 页面保存成功截图：机主/tmp/wechat-two-new-drafts-20261110.jpg。保留原请求、视频原件及投递记录，重试先查原状态。
- 本轮仅补充文档和真实验收证据，不改运行代码、不重启服务。此前编译/回归结果见前文；没有为文档改动重复构建。Hub独立MCP登记和主插件升级仍待连接绑定问题解决，源Skill更新不代表安装包已再发布或客户端已更新。GitHub推送此前被自动审核拒绝，本轮不重试，只保存远端本地提交。
