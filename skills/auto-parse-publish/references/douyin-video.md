# 抖音视频专用路线

服务器auto-parse-douyin-publish，端点https://auto-parse-v2.vyibc.com/api/publish/mcp/douyin。先tools/list定位真实前缀，读取workflow_capabilities.video。与抖音图文同属此平台MCP；不包含研究/采集工具。此平台直接复用84上经批准的Supabase视频适配器，不转调另一个平台端点、不复制发布实现。不要把受保护视频流程放进普通工作流调试器，也不使用旧publish.sh。

1. 复用当前任务已经确认的抖音稳定账号ID，服务在每次准备/发布中重新验证浏览器真实登录身份；无法确认时说明缺少accountId。该发布MCP不提供全机群账号扫描或登录工具，不用研究MCP补扫用户账号。
2. prepare_video输入accountId、videoUrl、title、requestId、aiGenerated，按需description、topics、cover。先读live schema。accountId是平台稳定ID，不是昵称；不传Cookie或clientId。
3. publish_video另需confirmPublish:true，必须对应本次内容/账号的公开发布授权。沿用稳定requestId。不能为了测试认证调用publish。
4. get_video_task({taskId})查原任务。submitted/published的含义以实际回执为准，不当作审核通过。
5. submission_unknown先核对原taskId和平台精确awemeId；reconcile_video_task({taskId,awemeId})只对账不再上传，但仍访问账号，应在原任务授权内。该端点不提供Fleet作品补登记工具，所需后续登记由原维护入口处理。

当前能力：标题30字、正文900字、最多5个话题。topics是caption_text，不保证平台原生话题实体。封面vertical/horizontal接口为experimental，未经实际验收不保证成功。上传保持原视频字节，当前本地上限512MiB、256KiB磁盘分块；此数值是实现限制，不代表平台官方最大限额。
真实创建回执与任务查询路线已验证，仍须每次核对账号、声明和新任务结果。
