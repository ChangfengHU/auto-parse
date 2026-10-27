# 抖音视频专用路线

服务器vyibc-douyin，端点https://fleet.vyibc.com/mcp/douyin；先tools/list定位真实前缀，读取vyibc-douyin_get_capabilities。该适配器复用84上经批准的Supabase副本；不要把受保护视频流程放进普通工作流调试器，也不使用旧skills/vyibc-auto-publish/scripts/publish.sh。

1. 已有授权账号ID时复用并在提交时复核；需要发现时可使用vyibc-douyin_discover_accounts({node:"host-84"})。发现会访问创作者页面，应有对应账号访问授权；多个账号无法判断时询问，不能任选。
2. prepare_video输入accountId、videoUrl、title、requestId、aiGenerated，按需description、topics、cover、clientId。先读live schema。accountId是平台稳定ID，不是昵称；clientId只是服务端授权会话引用，不传Cookie。
3. publish_video另需confirmPublish:true，必须对应本次内容/账号的公开发布授权。沿用稳定requestId。不能为了测试认证调用publish。
4. get_publish_task({taskId})查原任务。submitted/published的含义以实际回执为准，不当作审核通过。
5. submission_unknown先核对原taskId和平台精确awemeId；reconcile_publish_task({taskId,awemeId})只对账不再上传，但仍访问账号，应在原任务授权内。register_published_video只用于已有真实回执的登记，不能当发布器。

当前能力：标题30字、正文900字、最多5个话题。topics是caption_text，不保证平台原生话题实体。封面vertical/horizontal接口为experimental，未经实际验收不保证成功。上传保持原视频字节，当前本地上限512MiB、256KiB磁盘分块；此数值是实现限制，不代表平台官方最大限额。
真实创建回执与任务查询路线已验证，仍须每次核对账号、声明和新任务结果。
