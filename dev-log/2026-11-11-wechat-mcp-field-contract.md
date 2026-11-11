用户明确核心为发布插件工具与Skill，而非网页操作入口。抖音0.3.0已完成；本轮补齐公众号原生视频草稿MCP的workId继承、完整回执字段和按作品查稿；页面与MCP共用prepareWechatVideoWork。去重input/fingerprint形状不变，新来源上下文独立留存，旧input不覆盖。移除reserve时强写AI=false的半状态记录，真正预留持久化后再同步作品。未支持标签/自定义封面/AI声明显式拒绝并在结果标记，仍只存草稿。不改任何Supabase正式流程；本轮只验证已存在草稿和隔离测试。

46组相关回归通过，tsc零输出；覆盖旧URL调用/原输入指纹兼容、workId渠道账号继承、空正文/不支持字段/来源冲突拒绝、只读预检与查稿不调用浏览器、完整正文回传、源AI上下文不可变和原草稿复用。归档按SHA归并前后的只读预检ID可变化，但显式传入的预检requestId保持原样；有历史原请求时强制复用。原生capabilities同步列出5个媒体相关工具。

最终构建.next-wechat-mcp-fields-v060b-20261111成功，任务范围ESLint与全仓TypeScript检查零输出。路由目录区分旧实际验收日期与本次参数合同审阅日期，未把本次只读/隔离测试记成新增真实草稿创建。源码仅在84修改，未改Supabase正式流程或用户权限，保留所有无关dirty文件。

正式上线：源码9d5f050f8fafe7ce31ed689f9f795dd2279d4ae8，构建.next-wechat-mcp-fields-v060b-20261111；切换前无执行中workflow或近期原生媒体任务，持有两浏览器锁，旧构建配置已备份。已安装微信MCP回读0.6.0/36工具，作品MCP0.3.1；capabilities实际列出5个媒体工具、workIdReuse/fullInput和不支持字段。
真实只读验收：作品c94f498d604b7809ed8fc8bac38226fdc7cc4f91645d25e371cda9b6c65dccb1预检返回原请求workdraft-70db587a53eaddbf79f6a46af4a28ec466e4b0ddf1ba7e37，标题12/正文33字符；原生wechat_media_draft_status返回completed、完整11字段publicationInput、saveResponseAccepted和nativeEditorReloadVerified均true。旧记录无来源上下文返回null，不追改历史输入；本轮未新建草稿、未重跑原流程或公开发表。新增原生预检/按作品查询用隔离测试覆盖无浏览器调用；新客户端工具目录采用状态另看平台更新。
Hub固定版本回执：{"nativeMcp": {"version": "0.6.0", "registrationId": "65a3ae0a-7c41-4dde-955e-00b507ecf7c3"}, "worksMcp": {"version": "0.3.1", "registrationId": "db9852fe-3ed0-4efe-93c8-fa9e5aa39b5e"}, "plugin": {"version": "0.8.0", "registrationId": "134ddbef-e4ff-4aa8-ac2a-5d8dafd64f08", "archiveSha256": "adabd42f3f892d02818f321f1afd2e96d82230992f67e50239f68743a08a9a80", "autoPush": "queued"}}
auto-parse-publish完整8文件Skill0.8.0登记4d1850f2-5604-44a9-a3a6-ba9b46cd71e6；video-work-center Skill0.3.1登记c4494f00-969d-4ad0-9c19-93382c46fbf6。原插件保持5MCP+2Skill，不新增重复插件；ChatGPT客户端更新queued，未声称已经安装采用。GitHub推送仍受此前审批限制，本轮未重试。
