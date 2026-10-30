# 微信公众号：官方草稿箱

先读[格式选择、GIF位置与逐项验收](wechat-usage.md)。那里区分真实样例、本地边界和未验证事项；本页是完整参数、恢复和发表通道参考。

本平台支持图文草稿与原生贴图草稿，可删除指定草稿，另有依赖账号权限的官方发表工具；当前账号发表权限返回48001。不能群发。服务器为 auto-parse-wechat-publish，独立认证端点 /api/publish/mcp/wechat。公众号名称/环境由服务端配置，先读实际 wechat_capabilities 确认，不允许工具参数替换AppID、密钥或账号。

## 调用

1. wechat_capabilities：确认目标账号、draftOnly、可接受素材域名/格式。
2. wechat_account_status：实查官方接口与草稿总数；40164需要在公众号后台IP白名单添加返回的egressIp，该地址必须来自预期代理路径，不能直接填写机器IP；48001表示接口权限问题。不得反复猜密钥或改走未授权浏览器。
3. wechat_create_draft：requestId保持稳定，confirmDraft=true，articles为1至8篇。
   图文：articleType=news（默认）。每篇填写title、HTML content，另提供 thumbMediaId（本公众号永久封面素材ID）或 coverImageUrl，二选一。可选author、digest、contentSourceUrl、needOpenComment、onlyFansCanComment。
   coverImageUrl会自动上传永久图片；正文img必须是带引号的https src，来自实际允许的素材域名，非微信图片会自动通过微信正文图片接口上传并替换。data-src、srcset、活动脚本和不支持的嵌入标签会拒绝。
   贴图：articleType=newspic，title不超过20字，content为纯文本，本地拒绝20000 UTF-16单元或1MiB及以上；微信的真实上限未确认；images按展示顺序传1至20项，每项imageMediaId（本公众号永久图片素材ID）或imageUrl二选一，首张自动作为封面，不传thumbMediaId/coverImageUrl。服务使用官方image_info.image_list，不是把图片塞进HTML。
4. wechat_get_draft(mediaId)：使用创建回执media_id实查；列表用 wechat_list_drafts(offset,count,includeContent)，count为1至20。
5. 如需预先上传图片，用 wechat_upload_image(requestId,imageUrl,purpose)，purpose=cover或newspic返回永久media_id（不超过10MiB），inline返回微信url（不超过1MiB）。永久素材接受JPEG/PNG/GIF（GIF已真实上传、创建贴图草稿并在后台编辑器播放；手机与公开页动画未验收），外部正文图片导入仅JPEG/PNG；复用已上传微信GIF地址的图文路径见格式指南；先放到自有资源域名，不接受任意内网/外部URL，也不把本地文件路径作为图片地址。

适配器当前校验文章标题不超过32字、贴图标题不超过20字、作者8字、摘要120字；正文小于20000字符且小于1MiB，每篇最多30张正文图片，永久图片上限10MiB、正文图片上限1MiB。这些是现有代码边界，不能当作微信保证接受的上限。按最新官方文档更严格准备：标题建议不超过32字，外部正文图片导入使用小于1MB的JPEG/PNG；作者仍服从适配器8字限制。微信最终可能因权限、内容和素材参数拒绝。已支持公众号原生贴图newspic；已验证GIF在后台编辑器播放，手机及公开页面未验收，此图文/贴图工具不支持Live Photo、视频或Markdown自动排版；Markdown需先转换合适HTML。

## 恢复

- wechat_draft_request_status(requestId)读取单机持久账本；服务重启后保留。
- completed：同请求同内容直接回放原回执；同请求改内容会拒绝。
- failed：明确的微信业务拒绝或本地参数错误；修复外部条件后可用原请求重试。
- unknown/submitting或残留请求锁：可能已产生外部影响，先回查原请求与官方草稿列表，不能换请求编号重发。
- 上传有子请求账本，重试已明确失败的整篇任务时不会重复上传已确认成功的封面/正文图片。
- 账本不保存AppSecret/access_token或正文全文；只保留内容指纹、结果和安全错误。它不是跨机器分布式去重服务。残留锁不自动清除，需受信任维护流程核对微信结果。

返回status=draft_saved、media_id、文章数和创建时间时，代表微信已返回草稿创建回执；再读取同media_id确认内容。草稿不对外群发，不能称为已经发布。创建接口未知时不得宣称未创建。

## 已验证范围与网络
2026-10-29已完成官方认证、永久封面上传、一篇接入验证文章草稿创建、同media_id官方回读，以及同requestId重放返回原回执。同日已通过同一生产MCP创建8张早报原生贴图草稿，官方回读article_type=newspic；逐项比对8个永久图片ID顺序与首图封面，同请求重放返回原media_id，草稿仅增加1。此验证不代表已成功公开发表、群发、GIF播放或原生Live Photo。不得为了确认连接反复创建测试草稿，优先查询账号状态与已有回执。
服务端通过WECHAT_HTTPS_PROXY显式代理调用；代理缺失、配置无效或连接失败均不回退直连。代理地址及其认证配置由受信任服务端维护，不能作为MCP工具参数修改，不向普通输出回显。公众号AppSecret与MCP Bearer令牌是两种不同凭据。
插件0.4.0包含格式选择、GIF位置、已上传微信GIF复用与逐项验收指南；公众号Hub组件固定0.4.0，其他三个组件仍为0.1.0。已配置旧0.3.0专用连接的调用方继续使用同一服务凭据；需要更新包内指南时按安装器升级此插件，不删除其他插件或市场。

## 原生贴图调用示例
~~~json
{
 "requestId":"morning-image-draft-example-001",
 "confirmDraft":true,
 "articles":[{
  "articleType":"newspic",
  "title":"早报贴图示例",
  "content":"本期早报摘要。请替换为已审核的实际正文。",
  "images":[
   {"imageUrl":"https://resource.vyibc.com/your-first-card.png"},
   {"imageMediaId":"YOUR_ACCOUNT_PERMANENT_IMAGE_ID"}
  ]
 }]
}
~~~
示例地址和素材ID为占位符，不能直接执行。先准备实际可下载的JPEG/PNG，贴图GIF按格式指南中的已验证路径使用，保留展示顺序，再调用wechat_create_draft。回读检查news_item[0].article_type、image_info.image_list和thumb_media_id；不要仅凭status=draft_saved判断草稿格式。该MCP保存用户提供的图片，不自动把任意URL/Markdown排成卡片。仓库提供静态卡片导出脚本供受信任维护使用，不是远程任意代码工具。

## 单独删除与官方发表
wechat_delete_draft({requestId,mediaId,confirmDelete:true})只删除精确指定草稿，稳定请求可回放；测试草稿已真实创建、删除并回读不存在。
wechat_publish_draft({requestId,mediaId,confirmPublish:true})调用官方freepublish/submit，创建草稿和提交发表是两个动作；同一账号+mediaId持久防重复。wechat_publish_status({publishId})查询官方状态；submitted不等于发表成功。当前公众号实际账号只读权限检查返回48001，官方发表接口无权限；网页单篇贴图发表另用wechat_web_publish_draft，不自动回退或替代官方工具。禁止对未获授权内容提交公开发表。
wechat_get_draft和wechat_list_drafts可传normalized:true返回中性articles结构；默认保留原样。
能力声明的recommendedTimeoutMs为120000。超时后先查询原requestId状态和官方草稿箱；unknown或submitting不得更换ID盲目重试。
1400字测试返回微信45166，不能只凭这个错误判定长度上限。不得静默截断，微信如拒绝则原样返回错误码。

## 诊断与素材复用
wechat_capabilities({includeEgress:true})通过代理访问api.ipify.org并回报探测IP和时间。代理可按目标分流，该IP不保证等于微信看到的出口；应以微信错误中的出口或同路验证为准。
永久图片以下载字节SHA-256在同一公众号下去重，内容变化不会沿用旧素材；相同内容跨请求返回相同素材ID及materialReused:true。缓存对应微信素材若被外部删除，应先核对，不能绕过未知提交状态盲目重传。源码以前的上传账本不会自动回填去重缓存。
newspic可传liveCoverVideoUrl（受信任素材域名HTTPS）；此值仅保存至本机请求账本和创建回执的auxiliaryMetadata，wechat_draft_request_status按原requestId读取。它不会上传视频或在微信生成Live Photo；素材链接有效性及最终发布未验证。
本地校验和图片错误返回code、message、hint；贴图相关图片校验或上传错误可含1起始imageIndex；下载HTTP失败可含httpStatus。微信业务错误保留微信code并返回中文说明，仍须参照具体场景。


## 网页贴图发表（0.3.0）

同一公众号MCP新增wechat_web_publish_draft和wechat_web_publish_status。先用workflow_open_session打开准备流程9a676224-70bd-41d4-9e85-c8d2b83a00c4，browserInstance=1，vars={mediaId,expectedAccount}，运行后从history.output取得draftFingerprint，再关闭准备会话释放浏览器。expectedAccount必须是已登录公众号gh_原始ID，不是AppID。

只有用户已授权公开的具体草稿才能调用wechat_web_publish_draft({mediaId,expectedAccount,expectedFingerprint,requestId,aiGenerated:true,confirmPublish:true})。当前仅支持单篇newspic、20字标题和明确AI来源声明。工具会保存声明并走微信原生发表确认；Supabase正式发表流程为cea6d731-ce15-46d8-95fb-f420ebfacb93。异步返回sessionId后轮询workflow_get_session，awaiting_admin_scan时向管理员展示返回截图并保留同一任务页。不要看到节点done就关闭等待扫码的会话。

wechat_web_publish_status({expectedAccount,mediaId})读取重启持久账本。submitting/unknown均需查原会话和微信后台，禁止换requestId重发；submitted只证明最终请求获微信成功应答，不证明审核或公众可见。会话20分钟空闲失效；轮询刷新期限，重启不保留网页会话。账号+草稿意图不得删除以强行重发。

真实验证已到管理员扫码页面，测试未公开发表；最终真实提交和公众可见性尚未验收。两个入口共用活动锁与账本；REA CLI也依赖已登录浏览器，并非纯HTTP发布。完整服务端调用、恢复和CLI环境说明见仓库docs/wechat-web-prepare.md。


## GIF实际验收（2026-10-30）

使用自建540×720、30帧、3秒循环、111960字节GIF进行生产测试。微信永久素材上传成功；下载微信返回的素材仍有30个不同帧，文件SHA256与原图一致。通过同一MCP创建《GIF动效验证（勿发布）》原生newspic，第一张GIF、第二张静态对照；回读类型、两项顺序和首图封面一致。已登录后台编辑器直接显示GIF，连续四帧截图中的红色方块位置不同，确认实际动画播放。

直接预览链接出现微信“环境异常”验证；后台原生预览提供关注者微信号或扫码预览入口，未向预填联系人发送预览消息。手机预览、最终发表和公众页面动画仍未验证，没有公开测试稿。animatedGifVerified继续为false，gifVerification分项说明已验证阶段，不能将这个字段理解为GIF上传失败，也不能把上传成功当成完整发表验收。样本结果不保证所有大小、尺寸及客户端都支持。


## 原生视频和播客草稿

0.4.0新增 wechat_create_video_draft、wechat_create_podcast_draft、wechat_media_draft_status，使用已登录浏览器，与本页官方图文/贴图API路径独立。必须先阅读[专用工具的输入、异步状态和验收边界](wechat-usage.md#视频与播客专用-mcp)。不要把 videoUrl/audioUrl 传给 wechat_create_draft。
