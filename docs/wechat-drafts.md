# 微信公众号官方草稿箱

新增独立平台MCP：auto-parse-wechat-publish，https://auto-parse-v2.vyibc.com/api/publish/mcp/wechat。复用同一AutoParse服务与既有鉴权HTTP合同；七个wechat_*工具不提供任意HTTP、工作流编辑、公开发表、群发或删除。其他三个平台工具和工作流保持原样。

服务使用官方stable_token（force_refresh=false）、draft/add/get/batchget/count、material/add_material（永久封面）、media/uploadimg（正文图片）。不控制浏览器。运行要求：公众号AppID/AppSecret有效、官方接口权限、出口IP白名单；API返回40164时按egressIp加入白名单。稳定Token在进程内缓存/单飞；明确无效或过期后清缓存供下一次调用获取，绝不向客户端返回。

完整调用说明见 skills/auto-parse-publish/references/wechat-drafts.md。凭据仅在Vault service:wechat-official-account:<AppID>和权限0700/0600的服务配置；专用MCP凭据由PUBLISH_WECHAT_MCP_TOKEN配置，金库引用service:auto-parse-wechat-publish与hub:connection:fleet-owner:auto-parse-wechat-publish。源码不含真实凭据。轮换时更新金库和私密服务配置，MCP凭据另行轮换。

运行账本位于.data/wechat-drafts/<AppID>/，不是临时缓存。原子写入、同请求排他锁、内容指纹、submitting/completed/failed/unknown。网络超时/HTTP异常/无法解析响应按unknown保留，不自动重试。已确认微信业务拒绝允许原意图重试；进程中断遗留锁需先回查。多媒体子请求各有稳定账本，不把完成的上传重复执行。不要删除账本、换请求号或在多机器复制运行来绕过去重。

素材只接受受信任域名HTTPS URL，下载不携带微信Token，重定向逐跳重新校验，流式永久素材10MiB/正文图片1MiB上限且检查JPEG/PNG签名。平台调用Token只发往api.weixin.qq.com，官方请求禁止重定向；所有上游错误脱敏。正文图片导入完成后才写草稿。账号权限和上游校验仍可能拒绝内容。

官方文档入口：
- https://developers.weixin.qq.com/doc/offiaccount/Draft_Box/Add_draft.html
- https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/getStableAccessToken.html
- https://developers.weixin.qq.com/doc/offiaccount/Asset_Management/Adding_Permanent_Assets.html

本环境官方文档网页抓取失败，接口字段交叉核对了wechatpy上游源码（wechatpy/client/api/draft.py、material.py），并以实际接口响应及专项测试验证。不要把文档页面读取失败写为已阅读。

## 显式代理与白名单

公众号微信API、素材上传和素材下载使用WECHAT_HTTPS_PROXY指定的HTTP(S)代理，通过每次请求的Undici ProxyAgent dispatcher接入。84配置为本机Mihomo端口；未配置、配置无效或代理故障均失败关闭，不自动回退直连，不修改其他平台/浏览器的代理，也不设置全进程global dispatcher。依赖固定为undici6.29.1。

白名单必须填写微信实际看到的代理公网出口，以40164返回的egressIp或同一路径实测为准，不能直接填写服务所在机器IP。更换代理节点或出口后需要重新核对。此前使用native fetch的版本走了直连，旧记录中的机器出口仅代表当时实测路径，不能作为代理部署的配置依据。Token缓存按代理配置指纹隔离；不回显代理地址中的认证信息。

## 当前验收

实现、类型/构建、服务部署与MCP工具发现分开记录。首次直连认证返回40164；2026-10-29按用户纠正接入显式代理后，生产已通过认证、永久封面上传、一次测试草稿创建、同media_id官方回读和同requestId回放。草稿数仅增加1；没有公开发表/群发。43项回归、独立类型/Lint与构建通过。详见dev-log/2026-10-29-wechat-proxy.md；此前阻塞记录保留为历史。

## 回滚

空闲时将NEXT_BUILD_DIR切回保留的上一构建，只重启AutoParse；不要删除.data/wechat-drafts或既有平台发布账本。公众号专用EnvironmentFile可保留供回滚后重新启用，不覆盖其他平台凭据。

## 原生贴图补齐（2026-10-29）
同一wechat_create_draft新增articleType=newspic，images为1至20项有序imageMediaId或imageUrl；生成官方image_info.image_list，首张为封面，content纯文本。news默认行为、专用认证与账本保持兼容。七个工具身份不变，新增上传purpose=newspic；仅JPEG/PNG，不承诺GIF或Live。官方最新API文档已通过实际浏览器读取并核对字段：https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add 。
生产早报8张静态贴图已真实创建，官方回读newspic、8项顺序及首图封面通过，同请求回放同media_id且草稿仅增加1；没有公开发表。50项回归、独立类型/Lint、生产构建通过。通用静态导出：node scripts/render-newspic-cards.mjs input.json output-directory；输入brand/date/source/cards，每卡title/label/points/source，自动检查溢出，输出1080x1440 PNG、manifest和联系表；仅受信任维护调用，不是MCP任意脚本执行。
