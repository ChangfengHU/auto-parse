# WORKS-002
Owner clarified native WeChat video draft save+reload is the accepted completion. Independent works are separate from platform publishing; no fake delivery needed to register an unpublished work. Reuse the existing native WeChat video draft workflow. Existing public read UI remains; MCP writes require dedicated credentials. Preserve all current unrelated working changes and receipt ledgers. No public test publication.

138 isolated regression tests passed; TypeScript and focused ESLint passed. New per-work master registry, independent MCP with eight tools, dedicated service-only credential, async original retention, historical task/reference backfill, deterministic WeChat draft reuse and receipt polling implemented. No public publication tool. Source and byte hashes remain stable aliases. No existing platform credential copied or changed; new scoped connection stored in service private file/Vault binding without logging. Candidate .next-independent-works-v010-20261110.

已部署 c5374d3；补录与页面实测通过。真实公众号视频草稿卡在网页登录失效，未保存。Hub连接绑定核验未通过；读取该绑定秘密被自动审核拒绝，停止读取。独立Skill0.1.0已发布安装包，Hub与主插件尚未更新。CLI增加禁止root写台账；历史草稿文件名匹配已核对。

## 2026-11-10 双入口真实视频草稿验收（UTC 17:50–17:54）
本节替代前文“等待登录/新建未验收”的当前结论；历史失败记录仍保留。84浏览器1只读检查确认已登录gh_8dfb3900381c（唯伊不可）。复用Supabase工作流a5844b00-cd7b-442d-9e4f-8a5a18338b82《公众号视频与播客草稿》，测试前后updatedAt均为2026-10-30T07:40:55.645+00:00，未复制或修改原件，不改抖音流程。

- 实际已安装公众号MCP调用：标题“视频草稿MCP验收1110”，requestId=wechat-workflow-mcp-e2e-20261110-01，appMsgId=100002163，mediaIdentity=wxv_4777156190361272321，verifiedAt=2026-11-10T17:50:35.958Z。官方草稿mediaId=3UL3H6nAAGfSe70jlkoNLCes-ZCsi2pTB_gKIs6trf8SW8Sr-vxbK7oEmDHLIcUK。
- 实际作品中心页面点击保存：标题“视频草稿页面验收1110”，requestId=workdraft-70db587a53eaddbf79f6a46af4a28ec466e4b0ddf1ba7e37，appMsgId=100002168，mediaIdentity=wxv_4777160164632117249，verifiedAt=2026-11-10T17:54:18.146Z。官方草稿mediaId=3UL3H6nAAGfSe70jlkoNLH8PxbeUR0KkTAE7EHr5z7kjD0i3OQ7TidXKPJs0HRFX。
- 两次均completed，saveResponseAccepted/titleVerified/descriptionVerified/nativeEditorReloadVerified=true；原片4,198,703字节、64.922993秒，未压缩；published=false，playbackVerified=false。通过原生编辑器回读核对视频标识，不将官方API返回news类型视为播放器证据。
- 官方MCP列表独立读到两个新标题和不同mediaId；另有旧“API视频验证未通过勿发布”探测图文，总计3条，本次有效新增视频草稿为2条。未删除旧探测稿，未公开发表。
- 页面保存成功截图：机主/tmp/wechat-two-new-drafts-20261110.jpg。保留原请求、视频原件及投递记录，重试先查原状态。
- 本轮仅补充文档和真实验收证据，不改运行代码、不重启服务。此前编译/回归结果见前文；没有为文档改动重复构建。Hub独立MCP登记和主插件升级仍待连接绑定问题解决，源Skill更新不代表安装包已再发布或客户端已更新。GitHub推送此前被自动审核拒绝，本轮不重试，只保存远端本地提交。

## 2026-11-10 能力广场推送进展（UTC 18:13）
用户明确要求推送能力广场。现有vyibc-auto-publish为0.6.1；查询video-work无已登记记录。独立MCP0.1.1登记预检requestId=auto-parse-video-works-mcp-v011-20261110，返回hub_connection_binding_unavailable；查询该请求registration_not_found，未登记。目标https://auto-parse-v2.vyibc.com/api/video-works/mcp，引用hub:connection:fleet-owner:auto-parse-video-works。只读金库元数据表明此键存在，未读取该绑定秘密。为定位源码位置而读取宽泛boss:registry被自动审核拒绝：用户仅授权能力广场登记，该配置可能包含无关秘密；停止该路径，未改写任何连接或降低服务鉴权。
完整单文件Skill校验通过；已发布video-work-center 0.1.2，requestId=video-work-center-hub-v012-20261110；ZIP https://skill.vyibc.com/video-work-center/mcp-release/video-work-center-hub-v012-20261110/video-work-center-20261110181333.zip ，SHA256 c97fc4633900d8330aae9a42183b988628fb21b2385b63fe2b7d21ce3233bc13，安装器别名https://skill.vyibc.com/install-video-work-center.sh。发布器回执hubRegistration=not_requested，不等同广场登记、插件打包或ChatGPT推送。待授权仅检查并修复上述单条连接后，复用原MCP登记请求，登记Skill时依赖固定MCP0.1.1，再组合插件。未修改现有主插件，未部署业务代码或重启服务，未推送GitHub。
