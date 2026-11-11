---
name: video-work-center
description: 管理视频原片、多渠道与账号的标题正文封面版本、历史投递和筛选，并将已有作品保存为公众号原生视频草稿。
---

# 视频作品中心

作品页：https://auto-parse-v2.vyibc.com/video-works 。素材解析页 /materials 与作品档案分开。使用独立 MCP auto-parse-video-works，端点 https://auto-parse-v2.vyibc.com/api/video-works/mcp。连接由客户端配置；本 Skill 不含凭据，也不安装浏览器或恢复登录。

## 登记与历史补录

先用 list_video_works 按标题或原链接查询，get_video_work 读取选中作品。无匹配时，用户要求留存、补录，或当前创作流程明确要求入库，才调用 register_video_work。不是每次生成都擅自登记。

登记参数 sourceUrl、title、aiGenerated 必填，confirmRecord=true；复用已有正文和标签。支持 resource.vyibc.com、cdn.vyibc.com 的 HTTPS MP4，无查询参数或重定向。原片以原字节异步留存，不压缩；轮询 get_video_work 的 archive、retentionState、retentionError。注册成功与原片留存成功分别回报。

历史补录使用 backfill_video_work：
- 已有 AutoParse taskId：只读取原任务及真实回执，不重新执行。
- 只有视频原链接：复用上下文中的标题、正文、来源和标签，独立入库。可附 platformUrl，但它仅是未核验的历史线索。
- 无真实回执不能标记已发布；没有完整历史记录要明确说明，不能编造账号、平台链接或状态。

重复来源复用已有作品；旧URL哈希ID在原片按SHA256归并后仍可查询。主文案保留，平台改写不覆盖原文案。未发布的作品没有虚假的平台投递记录。

## 各渠道独立内容方案

同一作品原片、默认文案是一份，各渠道/账号的待发布内容单独版本化，实际投递 input 是历史快照，三者不能混淆。改写某渠道不能覆盖其他渠道或原作品，保存方案不代表已发或已存平台草稿。

1. list_video_works 支持 query 搜索原片/默认文案/各渠道正文、platforms 多选、platformMatch=any|all、states 多选；筛选先于分页。同一渠道的投递状态才可匹配该渠道条件；旧 platform 参数仍是单平台隔离投影。
2. 需要按渠道准备内容时，get_channel_content({workId,platform,accountId?})。返回 exact 账号方案、渠道默认方案、该渠道实际投递或作品默认的明确来源。不得沿用另一个渠道最近的内容。
3. 根据用户意图和该渠道已有真实限制改写 title、description、topics 和可选 cover.verticalUrl/horizontalUrl。封面必须是用户资源域 resource.vyibc.com 或 cdn.vyibc.com 的 HTTPS 无参数地址；不同平台可用不同封面。
4. save_channel_content 带 workId/platform/可选稳定accountId、完整title/description/topics、可选cover、刚读取的 expectedRevision、固定requestId、confirmSave=true。已有授权保存方案即可继续。revision冲突重新读取并比较，不盲目覆盖；响应未知先按原目标读取 lastRequestId/history，必要时仅重试同一请求同一内容。旧版本和实际投递快照均保留。
5. 用户授权发布/草稿后，把目标渠道方案的具体字段传给已有对应发布 MCP。本作品中心只为抖音准备页和公众号原生视频草稿做了复用衔接；不会因保存 Instagram、Threads、Facebook、TikTok、X、小红书或视频号方案就具备这些平台的视频发布能力。未接入须明确标注，不能伪造成功。
6. 公众号准备工具优先采用对应账号方案，再渠道默认，再原有记录。当前公众号视频草稿仍使用推荐帧封面；保存的自定义封面只作为方案，不承诺已应用到公众号。抖音封面沿用现有实验能力，需看实际回执。

## 网页管理与一键操作

作品页支持列表/卡片；渠道和状态用可多选按钮，任一/同时具备关系明确。列表每部作品一行、每渠道一列；点击进入渠道文案、分发记录、复用分发和原片详情。全文可查看/复制，发布记录包含当次标题正文和已留存封面；无记录不等于未发布。

页面公开可读。需要编辑渠道方案时，create_web_access({confirmWebAccess:true,includeContentEditing:true}) 为当前已授权所有者生成一次性入口；仅保存公众号草稿则不传 includeContentEditing。旧入口/会话保持旧权限。限时入口10分钟仅兑换一次，兑换后最长8小时HttpOnly会话；不允许公开发表、抖音操作或管理接口。不能把MCP/平台/管理员凭据填入浏览器、日志、正文或公开URL。入口本身仅交给所有者。

侧边栏“发布与草稿”可保存公众号草稿。MCP与页面共用去重和回执，未知结果先查询原任务，不换ID重建。未保存的修改离开前提示；历史文案只读，不随着新方案更新。退出后仍可直接查看。

## 从已有作品保存公众号视频草稿

用户说“这个已发布抖音的也存到公众号草稿”时：
1. 按上下文选择唯一作品；有歧义才让用户选择。不要重复索要已入库的视频、文案或账号。
2. 调用 prepare_wechat_video_draft({workId})，读取原片、账号及该渠道/账号的标题、正文。账号由已核验记录唯一推断，存在多个账号时不猜测。
3. needsAdaptation=true 时，由 Agent 保留主题改写为20个Unicode码点以内的标题、300码点以内的正文，再用可选 title、description 准备；不要机械截断。已有文案合格则直接复用。
4. 确认原片已留存；公众号限制100MiB、H.264 MP4、可选AAC、时长不超过3600秒。超限先说明，不擅自降低画质。
5. 用户已授权保存草稿后，调用 create_wechat_video_draft({workId,confirmDraft:true})，按需带改写文案。无需为已授权范围再请求确认。
6. 每约5秒查询 get_wechat_video_drafts({workId})。completed 且 receipt.saveResponseAccepted=true、receipt.nativeEditorReloadVerified=true，才报告视频草稿完成。保存响应、appMsgId、原生编辑器重新打开是验收依据，不等于手机播放或公开发表。
7. 稳定请求号由服务确定；相同作品、账号和文案复用原记录。unknown 或中断只查原请求，不能换文案、换ID来重建。failed 要查具体阶段；网页未登录时交还用户登录，不改Cookie、不重启浏览器，不删除台账绕过去重。

本工具只保存原生视频草稿，没有公开发表操作。公众号与视频号是不同平台。X视频、视频号和小红书作品转投尚未接入本 MCP，不能承诺支持。

## 事实与交付

交付作品页、workId、原片留存状态、目标账号、原请求号与真实草稿结果。草稿或发布失败仍保留记录。已核验草稿是当时的回读结果，之后后台手工修改需要重新核对。

2026-11-10：独立服务0.1.0已部署并通过138项相关回归。首次跨平台真机测试《Clawd交朋友》停在 checking_account；只读检查确认网页处于登录页，尚未上传或保存。不能把这次测试宣称草稿完成。Hub连接登记状态以实际回执为准。

2026-11-10后续验收：84浏览器1登录正确公众号后，复用正式Supabase工作流“公众号视频与播客草稿”（a5844b00-cd7b-442d-9e4f-8a5a18338b82），实际已安装公众号MCP和作品中心页面分别新建视频草稿100002163、100002168，保存响应与原生编辑器重新打开核对通过。官方MCP列表确认两个不同草稿；未公开发表，未验证手机播放。不需要再建重复流程；专用工具先预留持久请求，再由工作流执行，不能直接用通用工作流调用绕过预留、账号核对或去重。本段为源文档更新，Hub/安装包版本仍以实际回执为准。

2026-11-11更新：渠道独立方案、版本历史、双视图和多选过滤由同一作品服务提供；新增 get_channel_content/save_channel_content。上线、广场登记及客户端工具采用状态以各自实际回执为准。

## 侧边栏分发与统一抖音字段（0.3.0）

作品页点“分发”打开非模态右侧栏，列表保留，未保存修改用栏内提示处理，没有弹出确认框。抖音和公众号入口直接可见；公众号只存原生视频草稿。抖音侧栏支持标题、正文、最多5标签、横竖封面、AI声明、准备发布页、栏内核对后正式提交。其他平台仅管理方案，不冒充本视频转投已接入。

网页抖音操作必须由所有者明确要求后，create_web_access({confirmWebAccess:true,includeDouyinPublishing:true}) 生成一次性入口。它只额外允许已有作品在已核验抖音账号上的准备/显式公开提交，以及渠道编辑和公众号草稿；旧 works/works_editor 会话不扩权。每次公开发布仍需明确核对内容和目标，不能因为要测试界面就真的发布。入口仅交给授权所有者，不记录到日志。

auto-parse-douyin-publish 0.3.0 的 prepare_video / publish_video 可以传 workId、稳定 accountId、aiGenerated、requestId，省略的标题/正文/标签/封面读取该账号渠道方案；也保留 videoUrl+title 直接发布路径。显式传入字段优先，description=""、topics=[]、cover={} 表示清空/使用平台默认。workId与videoUrl冲突、格式不合法或未支持的参数会拒绝。MCP返回 publicationInput 是完整当次输入，页面分发记录读取同一投递台账，不从当前可编辑方案倒推旧内容。

标题30字、正文900字符、标签最多5个（不带#，限字母/汉字/数字/下划线，每个30字以内）；封面JPG/PNG、每张8MiB以内，自有资源域无参数HTTPS，仍属实验能力。定时、位置、合集商品、可见范围、评论开关和抖音云草稿保存尚未接入。公众号视频草稿不提交标签/自定义封面/AI声明，不把原片AI属性当成平台已应用声明。
