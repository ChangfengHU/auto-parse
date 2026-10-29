# 微信公众号：官方草稿箱

本平台当前仅支持图文草稿，不能公开发表、群发或删除。服务器为 auto-parse-wechat-publish，独立认证端点 /api/publish/mcp/wechat。公众号名称/环境由服务端配置，先读实际 wechat_capabilities 确认，不允许工具参数替换AppID、密钥或账号。

## 调用

1. wechat_capabilities：确认目标账号、draftOnly、可接受素材域名/格式。
2. wechat_account_status：实查官方接口与草稿总数；40164需要在公众号后台IP白名单添加返回的egressIp；48001表示接口权限问题。不得反复猜密钥或改走未授权浏览器。
3. wechat_create_draft：requestId保持稳定，confirmDraft=true，articles为1至8篇。
   每篇填写title、HTML content，另提供 thumbMediaId（本公众号永久封面素材ID）或 coverImageUrl，二选一。可选author、digest、contentSourceUrl、needOpenComment、onlyFansCanComment。
   coverImageUrl会自动上传永久图片；正文img必须是带引号的https src，来自实际允许的素材域名，非微信图片会自动通过微信正文图片接口上传并替换。data-src、srcset、活动脚本和不支持的嵌入标签会拒绝。
4. wechat_get_draft(mediaId)：使用创建回执media_id实查；列表用 wechat_list_drafts(offset,count,includeContent)，count为1至20。
5. 如需预先上传图片，用 wechat_upload_image(requestId,imageUrl,purpose)，purpose=cover返回永久media_id，inline返回微信url。图片须JPEG/PNG且不超过2MiB；先放到自有资源域名，不接受任意内网/外部URL，也不把本地文件路径作为图片地址。

文本限制为本适配器的保守限制：标题64字、作者8字、摘要120字；正文小于20000字符且小于1MiB，每篇最多30张正文图片。它们不代表平台所有内容形态的上限。暂不支持公众号原生图集、视频或Markdown自动排版；Markdown需先转换合适HTML。

## 恢复

- wechat_draft_request_status(requestId)读取单机持久账本；服务重启后保留。
- completed：同请求同内容直接回放原回执；同请求改内容会拒绝。
- failed：明确的微信业务拒绝或本地参数错误；修复外部条件后可用原请求重试。
- unknown/submitting或残留请求锁：可能已产生外部影响，先回查原请求与官方草稿列表，不能换请求编号重发。
- 上传有子请求账本，重试已明确失败的整篇任务时不会重复上传已确认成功的封面/正文图片。
- 账本不保存AppSecret/access_token或正文全文；只保留内容指纹、结果和安全错误。它不是跨机器分布式去重服务。残留锁不自动清除，需受信任维护流程核对微信结果。

返回status=draft_saved、media_id、文章数和创建时间时，代表微信已返回草稿创建回执；再读取同media_id确认内容。草稿不对外群发，不能称为已经发布。创建接口未知时不得宣称未创建。
