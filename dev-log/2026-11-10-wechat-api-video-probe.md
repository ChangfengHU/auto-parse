# API-WORKS-004
用户授权如果官方API支持，就用MCP和页面各创建一条视频草稿，共两条。官方草稿文档仅news/newspic，上传永久素材支持video，不等于视频草稿。现有服务拒绝音视频HTML，保持生产校验不变。先做受限服务器端article_type=video能力门槛探测：固定测试标题、既有测试封面、正式stable_token+代理+持久mutate台账，无公开发表、不猜video_info等字段。若明确不支持则不继续创建两条假视频稿。官方草稿列表本轮开始0条，旧测试media_id 40007失效。测试仅在84，不读取或回显密钥，使用既有环境文件由systemd加载。

## 真实结果
官方公开文档经只读抓取核对：draft/add文章类型news/newspic；material/add_material支持type=video（文档10MB MP4），视频素材与草稿不是同一对象。
MCP开测草稿列表0。第一次隔离脚本遗漏fetch绑定，在认证调用前终止；MCP查询两条探测请求均found=false，无上传或草稿意图。修复绑定后，稳定原请求继续。
1. article_type=video，完整通用必填字段与本轮封面：微信HTTP200/errcode0，但draft/get为news，无视频字段。未知类型被当作图文处理，不能算视频草稿成功。
2. 真实原片4198703字节上传永久video素材成功，素材ID 3UL3H6nAAGfSe70jlkoNLE0uQaq74JwiO__BYAT22UT_kojDTRCGH-X6_VYPbP59。取回微信mpvideo.qpic.cn下载地址，仅在服务端实验中使用标准video标签更新本轮同一测试稿。微信update返回0，但回读正文34字符，video/iframe/微信视频标记/源地址均不存在。未宣称播放器播放成功。
3. MCP wechat_get_draft独立回读确认正文只剩文字；wechat_list_drafts确认仅1条。将本轮该草稿标注《API视频验证未通过勿发布》，内容明确未通过且不是有效视频草稿。草稿ID 3UL3H6nAAGfSe70jlkoNLN2cmmSXOkFjifhHh0LK_pXUQ7-koxycKz1zD8A7C6rp。未删除测试稿、未公开发表、未创建第二条假视频草稿。
结论仅限已测的公开API方案：没有成功把视频写进可用草稿。用户要求的MCP+页面2条有效视频草稿尚未完成；支持条件未满足，停止页面创建测试。既有原生视频浏览器路线仍待公众号登录。不宣称所有未公开接口均不可能；不改生产HTML校验、不猜video_info等未文档参数。
生产服务未改、未重启；代码只增加固定目标的手动探测脚本。沿用既有私有配置由systemd加载，仅操作微信官方API，不输出凭据/临时预览链接。没有GitHub推送。
