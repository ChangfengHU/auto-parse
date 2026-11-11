# 抖音视频专用路线

服务器auto-parse-douyin-publish，端点https://auto-parse-v2.vyibc.com/api/publish/mcp/douyin。先tools/list定位真实前缀，读取workflow_capabilities.video。与抖音图文同属此平台MCP；不包含研究/采集工具。此平台直接复用84上经批准的Supabase视频适配器，不转调另一个平台端点、不复制发布实现。不要把受保护视频流程放进普通工作流调试器，也不使用旧publish.sh。

1. 复用当前任务已经确认的抖音稳定账号ID，服务在每次准备/发布中重新验证浏览器真实登录身份；无法确认时说明缺少accountId。该发布MCP不提供全机群账号扫描或登录工具，不用研究MCP补扫用户账号。
2. prepare_video输入accountId、videoUrl、title、requestId、aiGenerated，按需description、topics、cover。先读live schema。accountId是平台稳定ID，不是昵称；不传Cookie或clientId。
3. publish_video另需confirmPublish:true，必须对应本次内容/账号的公开发布授权。沿用稳定requestId。不能为了测试认证调用publish。
4. get_video_task({taskId})查原任务。submitted/published的含义以实际回执为准，不当作审核通过。
5. submission_unknown先核对原taskId和平台精确awemeId；reconcile_video_task({taskId,awemeId})只对账不再上传，但仍访问账号，应在原任务授权内。该端点不提供Fleet作品补登记工具，所需后续登记由原维护入口处理。

当前能力：标题30字、正文900字、最多5个话题。topics是caption_text，不保证平台原生话题实体。封面vertical/horizontal接口为experimental，未经实际验收不保证成功。上传保持原视频字节，当前本地上限512MiB、256KiB磁盘分块；此数值是实现限制，不代表平台官方最大限额。
真实创建回执与任务查询路线已验证，仍须每次核对账号、声明和新任务结果。

## 视频作品中心与永久留存（抖音 MCP 0.3.0）

页面 https://auto-parse-v2.vyibc.com/video-works 是已投递作品入口，区别于 /materials 解析素材。默认显示已取得真实发布回执的视频，可切换草稿、已准备、失败与未知状态。一个视频保留各平台投递历史。

- 抖音使用 list_video_works({query?,state?,accountId?,offset?,limit?}) 和 get_video_work({workId}) 查询永久档案。返回原视频来源、原片是否已保留、各次请求与回执；只返回抖音范围。先查档案再判断是否需要重新投递，查询不发布。
- get_video_task 在七天任务缓存失效时回查永久回执；workflowExecution:null 表示只有档案，没有可恢复运行的任务。不能把缓存过期当作没发布，更不能换 requestId 重发。
- 原片上传前按实际SHA256保留，不压缩；同内容可归并，源URL保留。源链接失效时可使用保存的原件；未备份的历史来源会明确显示。当前备份位于服务持久磁盘，不宣称异地副本或无限存储。
- 作品页可准备抖音发布页、创建公众号视频草稿。抖音 prepare_video 仍不等于保存云草稿；公众号 draft_saved 需要实际保存与原生编辑器重新打开核对。页面专用授权侧栏支持核对后的抖音公开提交；准备页本身仍不等于发布。
- 作品中心的列表、详情、原片和封面按所有者要求直接查看，无需安全连接；Fleet小工具提供直接跳转。准备、保存草稿和发布仍由已有授权MCP执行；公开查看不授予账号操作权限，平台凭据仍不可互换。
- 小红书已有原发布工作流，但作品中心转投适配尚未完成；X尚不支持视频；视频号未接入。不可将公众号当作视频号。
- 历史回补只读取已有任务和回执，不代表重新发布；有创建回执仍不等于当前审核通过或公开可见。测试稿、失败和未知记录必须如实显示。

0.3.0：prepare_video/publish_video可使用workId继承目标账号的渠道标题、正文、topics和cover；显式空正文/空数组/cover={}可清空继承值，仍需稳定accountId、requestId、真实aiGenerated和发布确认。直接videoUrl+title兼容保留；参数冲突或不支持项拒绝。返回publicationInput完整快照并写同一作品台账。页面非模态侧栏与MCP共用解析器，准备页仍非抖音云草稿。
