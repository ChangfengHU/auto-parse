# 微信公众号：官方草稿箱

本平台支持图文草稿与原生贴图草稿，可删除指定草稿，另有依赖账号权限的官方发表工具；当前账号发表权限返回48001。不能群发。服务器为 auto-parse-wechat-publish，独立认证端点 /api/publish/mcp/wechat。公众号名称/环境由服务端配置，先读实际 wechat_capabilities 确认，不允许工具参数替换AppID、密钥或账号。

## 调用

1. wechat_capabilities：确认目标账号、draftOnly、可接受素材域名/格式。
2. wechat_account_status：实查官方接口与草稿总数；40164需要在公众号后台IP白名单添加返回的egressIp，该地址必须来自预期代理路径，不能直接填写机器IP；48001表示接口权限问题。不得反复猜密钥或改走未授权浏览器。
3. wechat_create_draft：requestId保持稳定，confirmDraft=true，articles为1至8篇。
   图文：articleType=news（默认）。每篇填写title、HTML content，另提供 thumbMediaId（本公众号永久封面素材ID）或 coverImageUrl，二选一。可选author、digest、contentSourceUrl、needOpenComment、onlyFansCanComment。
   coverImageUrl会自动上传永久图片；正文img必须是带引号的https src，来自实际允许的素材域名，非微信图片会自动通过微信正文图片接口上传并替换。data-src、srcset、活动脚本和不支持的嵌入标签会拒绝。
   贴图：articleType=newspic，title不超过32字，content为纯文本，本地拒绝20000 UTF-16单元或1MiB及以上；微信的真实上限未确认；images按展示顺序传1至20项，每项imageMediaId（本公众号永久图片素材ID）或imageUrl二选一，首张自动作为封面，不传thumbMediaId/coverImageUrl。服务使用官方image_info.image_list，不是把图片塞进HTML。
4. wechat_get_draft(mediaId)：使用创建回执media_id实查；列表用 wechat_list_drafts(offset,count,includeContent)，count为1至20。
5. 如需预先上传图片，用 wechat_upload_image(requestId,imageUrl,purpose)，purpose=cover或newspic返回永久media_id（不超过10MiB），inline返回微信url（不超过1MiB）。永久素材接受JPEG/PNG/GIF（GIF真实上传及播放未验收），正文图片仅JPEG/PNG；先放到自有资源域名，不接受任意内网/外部URL，也不把本地文件路径作为图片地址。

适配器当前校验标题不超过32字、作者8字、摘要120字；正文小于20000字符且小于1MiB，每篇最多30张正文图片，永久图片上限10MiB、正文图片上限1MiB。这些是现有代码边界，不能当作微信保证接受的上限。按最新官方文档更严格准备：标题建议不超过32字，正文图片使用小于1MB的JPEG/PNG；作者仍服从适配器8字限制。微信最终可能因权限、内容和素材参数拒绝。已支持公众号原生贴图newspic；暂未验收GIF实际播放，不支持Live Photo、视频或Markdown自动排版；Markdown需先转换合适HTML。

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
插件0.3.4包含v2调用指南；公众号Hub组件固定0.2.1，其他三个组件仍为0.1.0。已配置旧0.3.0专用连接的调用方继续使用同一服务凭据；需要更新包内指南时按安装器升级此插件，不删除其他插件或市场。

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
示例地址和素材ID为占位符，不能直接执行。先准备实际可下载的JPEG/PNG，保留展示顺序，再调用wechat_create_draft。回读检查news_item[0].article_type、image_info.image_list和thumb_media_id；不要仅凭status=draft_saved判断草稿格式。该MCP保存用户提供的图片，不自动把任意URL/Markdown排成卡片。仓库提供静态卡片导出脚本供受信任维护使用，不是远程任意代码工具。

## 单独删除与官方发表
wechat_delete_draft({requestId,mediaId,confirmDelete:true})只删除精确指定草稿，稳定请求可回放；测试草稿已真实创建、删除并回读不存在。
wechat_publish_draft({requestId,mediaId,confirmPublish:true})调用官方freepublish/submit，创建草稿和提交发表是两个动作；同一账号+mediaId持久防重复。wechat_publish_status({publishId})查询官方状态；submitted不等于发表成功。当前公众号实际账号只读权限检查返回48001，官方发表接口无权限；网页按草稿ID发表尚未实现。禁止对未获授权内容提交公开发表。
wechat_get_draft和wechat_list_drafts可传normalized:true返回中性articles结构；默认保留原样。
能力声明的recommendedTimeoutMs为120000。超时后先查询原requestId状态和官方草稿箱；unknown或submitting不得更换ID盲目重试。
1400字测试返回微信45166，不能只凭这个错误判定长度上限。不得静默截断，微信如拒绝则原样返回错误码。

## 诊断与素材复用
wechat_capabilities({includeEgress:true})通过代理访问api.ipify.org并回报探测IP和时间。代理可按目标分流，该IP不保证等于微信看到的出口；应以微信错误中的出口或同路验证为准。
永久图片以下载字节SHA-256在同一公众号下去重，内容变化不会沿用旧素材；相同内容跨请求返回相同素材ID及materialReused:true。缓存对应微信素材若被外部删除，应先核对，不能绕过未知提交状态盲目重传。源码以前的上传账本不会自动回填去重缓存。
newspic可传liveCoverVideoUrl（受信任素材域名HTTPS）；此值仅保存至本机请求账本和创建回执的auxiliaryMetadata，wechat_draft_request_status按原requestId读取。它不会上传视频或在微信生成Live Photo；素材链接有效性及最终发布未验证。
本地校验和图片错误返回code、message、hint；贴图相关图片校验或上传错误可含1起始imageIndex；下载HTTP失败可含httpStatus。微信业务错误保留微信code并返回中文说明，仍须参照具体场景。
