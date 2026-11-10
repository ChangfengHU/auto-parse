# FRONTEND-WORKS-003
用户要求页面与MCP都能操作。沿用此前视频草稿范围。公开浏览不变，草稿操作使用限时受限网页会话；由已认证的独立MCP发放一次性10分钟入口，兑换8小时仅限已有作品公众号视频草稿的HttpOnly会话。新入口不传管理员或平台服务凭据。卡片与详情可保存、查原任务状态，失败或未知不盲重建。不开公开发表接口。开发与部署只在84，保护其他改动，不推送GitHub。

17项相关隔离回归通过；新增组件/路由与依赖TypeScript通过；focused ESLint零告警。包括匿名/抖音凭据不可写公众号、网页草稿会话不可调用旧抖音准备接口、CSRF拒绝、入口仅一次/10分钟、HttpOnly会话仅草稿权限、未知结果不重复创建。下一步构建与真实页面验证。

初版上线519e7d6；CUA限时入口兑换成功，实际卡片点击《MCP视频草稿测试》复用旧请求mcptest-video-20261105-r2和草稿100001831，没有新建；只读查看《Clawd交朋友》显示checking_account失败。自动审核拒绝再次点击该失败作品的保存按钮，已改为只读状态检查，未绕过。窄屏发现草稿区被旧时间线挤到下方，改为窄屏优先显示草稿区；详情头固定以保留关闭入口。修复状态刷新时未提供sessionId导致旧taskId丢失，新增回归。未登录的新建草稿仍待用户登录后验收。

最终修订版de8824b已部署；公开列表200，匿名写401；19作品42投递，与测试前相同。仅从两个原始native回执恢复任务引用，状态刷新回归确保后续保留。CUA390px操作区优先、桌面布局、Escape关闭已验证，viewport重置。当前浏览器8小时草稿会话启用；没有把MCP/管理员/平台Token传入浏览器。Skill0.1.1经Hub静态校验并发布安装包；Hub登记和主插件升级仍未完成。截图在机主/tmp/video-work-web-draft-overview-20261110.jpg、/tmp/video-work-web-draft-saved-20261110.jpg、/tmp/video-work-web-draft-mobile-20261110.jpg；新建真实草稿仍待网页登录，任务保持In Progress，不声称完整新建验收完成。

## 2026-11-10 双入口真实视频草稿验收（UTC 17:50–17:54）
本节替代前文“等待登录/新建未验收”的当前结论；历史失败记录仍保留。84浏览器1只读检查确认已登录gh_8dfb3900381c（唯伊不可）。复用Supabase工作流a5844b00-cd7b-442d-9e4f-8a5a18338b82《公众号视频与播客草稿》，测试前后updatedAt均为2026-10-30T07:40:55.645+00:00，未复制或修改原件，不改抖音流程。

- 实际已安装公众号MCP调用：标题“视频草稿MCP验收1110”，requestId=wechat-workflow-mcp-e2e-20261110-01，appMsgId=100002163，mediaIdentity=wxv_4777156190361272321，verifiedAt=2026-11-10T17:50:35.958Z。官方草稿mediaId=3UL3H6nAAGfSe70jlkoNLCes-ZCsi2pTB_gKIs6trf8SW8Sr-vxbK7oEmDHLIcUK。
- 实际作品中心页面点击保存：标题“视频草稿页面验收1110”，requestId=workdraft-70db587a53eaddbf79f6a46af4a28ec466e4b0ddf1ba7e37，appMsgId=100002168，mediaIdentity=wxv_4777160164632117249，verifiedAt=2026-11-10T17:54:18.146Z。官方草稿mediaId=3UL3H6nAAGfSe70jlkoNLH8PxbeUR0KkTAE7EHr5z7kjD0i3OQ7TidXKPJs0HRFX。
- 两次均completed，saveResponseAccepted/titleVerified/descriptionVerified/nativeEditorReloadVerified=true；原片4,198,703字节、64.922993秒，未压缩；published=false，playbackVerified=false。通过原生编辑器回读核对视频标识，不将官方API返回news类型视为播放器证据。
- 官方MCP列表独立读到两个新标题和不同mediaId；另有旧“API视频验证未通过勿发布”探测图文，总计3条，本次有效新增视频草稿为2条。未删除旧探测稿，未公开发表。
- 页面保存成功截图：机主/tmp/wechat-two-new-drafts-20261110.jpg。保留原请求、视频原件及投递记录，重试先查原状态。
- 本轮仅补充文档和真实验收证据，不改运行代码、不重启服务。此前编译/回归结果见前文；没有为文档改动重复构建。Hub独立MCP登记和主插件升级仍待连接绑定问题解决，源Skill更新不代表安装包已再发布或客户端已更新。GitHub推送此前被自动审核拒绝，本轮不重试，只保存远端本地提交。
