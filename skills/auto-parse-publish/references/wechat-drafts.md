# 微信公众号：官方草稿箱

本平台当前仅支持图文草稿，不能公开发表、群发或删除。服务器为 auto-parse-wechat-publish，独立认证端点 /api/publish/mcp/wechat。公众号名称/环境由服务端配置，先读实际 wechat_capabilities 确认，不允许工具参数替换AppID、密钥或账号。

## 调用

1. wechat_capabilities：确认目标账号、draftOnly、可接受素材域名/格式。
2. wechat_account_status：实查官方接口与草稿总数；40164需要在公众号后台IP白名单添加返回的egressIp，该地址必须来自预期代理路径，不能直接填写机器IP；48001表示接口权限问题。不得反复猜密钥或改走未授权浏览器。
3. wechat_create_draft：requestId保持稳定，confirmDraft=true，articles为1至8篇。
   每篇填写title、HTML content，另提供 thumbMediaId（本公众号永久封面素材ID）或 coverImageUrl，二选一。可选author、digest、contentSourceUrl、needOpenComment、onlyFansCanComment。
   coverImageUrl会自动上传永久图片；正文img必须是带引号的https src，来自实际允许的素材域名，非微信图片会自动通过微信正文图片接口上传并替换。data-src、srcset、活动脚本和不支持的嵌入标签会拒绝。
4. wechat_get_draft(mediaId)：使用创建回执media_id实查；列表用 wechat_list_drafts(offset,count,includeContent)，count为1至20。
5. 如需预先上传图片，用 wechat_upload_image(requestId,imageUrl,purpose)，purpose=cover返回永久media_id，inline返回微信url。图片须JPEG/PNG且不超过2MiB；先放到自有资源域名，不接受任意内网/外部URL，也不把本地文件路径作为图片地址。

适配器当前校验标题不超过64字、作者8字、摘要120字；正文小于20000字符且小于1MiB，每篇最多30张正文图片，图片下载上限2MiB。这些是现有代码边界，不能当作微信保证接受的上限。按最新官方文档更严格准备：标题建议不超过32字，正文图片使用小于1MB的JPEG/PNG；作者仍服从适配器8字限制。微信最终可能因权限、内容和素材参数拒绝。暂不支持公众号原生贴图newspic、GIF、Live Photo、视频或Markdown自动排版；Markdown需先转换合适HTML。

## 恢复

- wechat_draft_request_status(requestId)读取单机持久账本；服务重启后保留。
- completed：同请求同内容直接回放原回执；同请求改内容会拒绝。
- failed：明确的微信业务拒绝或本地参数错误；修复外部条件后可用原请求重试。
- unknown/submitting或残留请求锁：可能已产生外部影响，先回查原请求与官方草稿列表，不能换请求编号重发。
- 上传有子请求账本，重试已明确失败的整篇任务时不会重复上传已确认成功的封面/正文图片。
- 账本不保存AppSecret/access_token或正文全文；只保留内容指纹、结果和安全错误。它不是跨机器分布式去重服务。残留锁不自动清除，需受信任维护流程核对微信结果。

返回status=draft_saved、media_id、文章数和创建时间时，代表微信已返回草稿创建回执；再读取同media_id确认内容。草稿不对外群发，不能称为已经发布。创建接口未知时不得宣称未创建。

## 已验证范围与网络
2026-10-29已完成官方认证、永久封面上传、一篇接入验证文章草稿创建、同media_id官方回读，以及同requestId重放返回原回执。此验证不代表支持公开发表、群发、newspic贴图、GIF或原生Live Photo。不得为了确认连接反复创建测试草稿，优先查询账号状态与已有回执。
服务端通过WECHAT_HTTPS_PROXY显式代理调用；代理缺失、配置无效或连接失败均不回退直连。代理地址及其认证配置由受信任服务端维护，不能作为MCP工具参数修改，不向普通输出回显。公众号AppSecret与MCP Bearer令牌是两种不同凭据。
插件0.3.1包含更新指南和验收状态，四个平台MCP组件仍固定0.1.0。已配置旧0.3.0专用连接的调用方继续使用同一服务凭据；需要更新包内指南时按安装器升级此插件，不删除其他插件或市场。
