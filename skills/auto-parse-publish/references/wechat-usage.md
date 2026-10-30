# 公众号格式选择与验收清单

核验日期：2026-10-30。服务端 MCP 0.3.1；本指南区分真实生产样例、代码/自动化边界测试、仅界面观察和未验证事项。未验证不写成可用承诺。测试样例保存草稿，不公开发表。

## 先选模式

| 要做什么 | 调用/参数 | 当前证据与限制 |
| --- | --- | --- |
| 图文文章 | wechat_create_draft，articleType=news，HTML content，thumbMediaId 或 coverImageUrl 二选一 | 已真实建草稿、按同 media_id 回读、防重复重放。正文外部导入 JPEG/PNG；已上传到微信的 GIF URL 可复用，已真实创建草稿并回读，编辑器显示已确认，但四帧截图静止，未证实播放 |
| 贴图/图片消息 | 同一工具，articleType=newspic，纯文本 content，images 有序数组 | 已真实创建 8 张静态图早报；首图GIF和静态封面+第二张GIF两种组合均已在后台播放 |
| 文字配图片 | 选择以上一种内容结构 | 没有独立“纯文字发布”工具；不能省略必需封面或图片假装纯文字类型 |
| 视频 | 网页“视频”入口 | 网页6秒视频草稿已获成功保存回执；专用 MCP 创建工具尚未实现，回读结果见末尾 |
| 播客（音频） | 网页“播客”入口 | 界面是播客，不是博客；12秒MP3网页草稿已获保存回执，专用 MCP 创建工具尚未实现 |
| Live Photo | 无 | liveCoverVideoUrl 仅存本地台账，不上传视频、不生成实况照片 |
| 正式发表 | 独立 wechat_publish_draft 或 wechat_web_publish_draft | 官方通道当前账号权限 48001；网页只验证到管理员扫码，最终公开提交未验收。草稿成功不代表发表成功 |

## GIF 到底放在哪里

- 贴图 images[0] 是**封面，同时也是内容第一张**，没有独立封面字段。GIF 放在这里，验证的是后台编辑器中该内容图播放，不代表信息流缩略封面或手机卡片也动。
- 静态封面配内容 GIF：第一项放 JPEG/PNG，GIF 放第二项及之后。非封面位置的实测结果见末尾。
- 贴图中 GIF 与 JPEG/PNG 共用图片数量，不额外增加“动图额度”。
- 图文文章正文的**外部图片导入通道** purpose=inline 仅允许 JPEG/PNG，GIF 已在生产调用中确认拒绝。另一条路径是先按永久图片上传 GIF，再将返回的 HTTPS mmbiz.qpic.cn 地址放入 news 的 HTML img src；服务复用已有微信素材，不重复走 inline 上传。此路径已真实创建《图文正文GIF验证（勿发布）》并回读含 GIF 的正文，后台已显示GIF引用，但连续四帧截图相同，未证实动画播放。不要笼统声称“图文正文不支持GIF”，也不要把两条上传路径混为一谈。
- 图文文章的 coverImageUrl / purpose=cover 代码接受 GIF，但**文章封面 GIF 未完成真实草稿与显示验收**。默认用已验证的静态封面。
- 素材 GIF 已保留全部 30 个不同帧及原文件哈希；贴图首图及非封面第二张 GIF 均在后台编辑器实际播放。手机预览、信息流封面、公开页播放未验证。animatedGifVerified=false 表示完整端到端验收仍未完成，不表示已验证的上传失败。
- 样例是 540×720、30 帧、3 秒循环、111960 字节；不将样例结论扩大到任意尺寸、体积和客户端。

## 数量和长度：代码限制不等于上游保证

| 项目 | 当前本地边界 | 验证依据 |
| --- | --- | --- |
| 一次请求文章条数 | 1–8 篇 | 代码检查和回归；生产样例为单篇，未验收 8 篇组合 |
| 每篇贴图图片 | 1–20 张，静态/GIF 合并计数 | 本地越界拒绝回归；实测 8 张静态、2 张静态/GIF混合；未实测 20 张 GIF |
| 贴图标题 | 最多 20 个 Unicode 码点 | 代码 Array.from 计数、21字拒绝测试；不是20个中文字节 |
| 图文标题 | 最多 32 个 Unicode 码点 | 代码检查、33字拒绝测试 |
| 作者/摘要 | 8/120 个 Unicode 码点 | 本地校验；不是微信真实上限认证 |
| 正文 | 小于 20000 个 UTF-16 单元，且小于 1MiB；超限拒绝，不截断 | 代码/回归。1400字生产测试曾返回45166，原因未确定，不能承诺微信接受20000字 |
| 正文图片 | 每篇最多 30 张 JPEG/PNG | 本地校验，未生产测试30张 |
| 永久封面/贴图图片 | 每张不超过 10MiB，JPEG/PNG/GIF | 代码及体积/格式回归；GIF真实样例111960字节 |
| 图文正文图片 | 每张不超过 1MiB，JPEG/PNG | 代码及格式/体积回归 |

没有通用“已验证的最大长图高度”承诺。用户/其他Agent报告的1080×8640成功、16000高度观察，若未经本助手读取同一草稿和素材复核，只能注明外部报告，不能冒充本轮实测。

本次后台贴图编辑器仍显示1000字计数。本地20000单元边界不代表网页编辑器放宽，也不代表微信最终接受；长正文需单独实测。

## 贴图调用顺序

1. 调用 wechat_capabilities 和 wechat_account_status，确认公众号和接口可用。服务端已有凭据，参数中不传 AppSecret。
2. 准备允许域名上的 HTTPS 图片，或本公众号永久图片 media_id。images 中每项 imageUrl / imageMediaId 二选一。无需先逐张上传，create_draft 会自动导入 URL 图片。
3. 生成一次意图的 requestId，保存并始终复用。调用 wechat_create_draft，confirmDraft=true。
4. 用返回 media_id 调用 wechat_get_draft。核对 news_item[0].article_type=newspic、title、content、image_info.image_list 顺序、thumb_media_id 为首图。normalized=true 时包装为 articles。
5. 建议调用超时120秒。这是客户端配置建议，不是工具参数或完成时间承诺。超时先用原 requestId 查 wechat_draft_request_status，再查草稿；unknown/submitting 禁止换 ID 重提。
6. 仅需已保存草稿时到此结束。公开发表是单独授权、单独工具及验收步骤。

下列两个 JSON 是参数模板，结构按真实 tools/list 校验；REPLACE_* 必须替换。模板校验不等于执行了该模板所代表的每次写入。使用当前账号的永久素材 ID，不能跨账号复用。

**GIF 同时作为首张内容和封面：**

~~~json
{
  "requestId": "REPLACE_STABLE_REQUEST_ID",
  "confirmDraft": true,
  "articles": [{
    "articleType": "newspic",
    "title": "动图贴图示例",
    "content": "替换为实际正文。",
    "images": [
      {"imageMediaId": "REPLACE_GIF_PERMANENT_MEDIA_ID"},
      {"imageMediaId": "REPLACE_STATIC_PERMANENT_MEDIA_ID"}
    ]
  }]
}
~~~

**静态封面，GIF 放在内容第二张：**

~~~json
{
  "requestId": "REPLACE_ANOTHER_STABLE_REQUEST_ID",
  "confirmDraft": true,
  "articles": [{
    "articleType": "newspic",
    "title": "静态封面内容动图",
    "content": "替换为实际正文。",
    "images": [
      {"imageMediaId": "REPLACE_STATIC_PERMANENT_MEDIA_ID"},
      {"imageMediaId": "REPLACE_GIF_PERMANENT_MEDIA_ID"}
    ]
  }]
}
~~~

复用素材时可先调用 wechat_upload_image，参数 purpose=newspic、imageUrl 为真实资源链接、requestId 为稳定上传请求号。返回 permanent media_id 后填入以上数组。生产样例已验证已有永久素材直接建草稿，无须重复上传。

## 本轮新增结果

非封面 GIF：生产请求 gif-content-position-20261030-draft-01，草稿《GIF内容位验证（勿发布）》已创建、官方回读确认静态图在首位且是封面，GIF 在第二位。后台已切换到第二张，四帧红色方块位置70.5→106.5→143.0→186.5，确认非封面内容GIF播放；没有保存编辑器改动或公开发表。

视频与播客网页草稿均获成功保存回执，官方草稿列表均已查到；两者尚未纳入可直接调用的 MCP 创建工具。没有使用不存在的 videoUrl/audioUrl 参数，也没有把音视频写入 news HTML 绕过校验。

## 图文正文复用微信 GIF

这是与 inline 上传不同的已验证建稿路径：
1. 使用 wechat_upload_image({requestId, imageUrl, purpose:"newspic"}) 上传 GIF，取得本公众号永久素材 URL。该步骤生产已验证保留30帧。
2. 使用微信返回的 mmbiz.qpic.cn 地址；本次已验证同一地址从 http 使用 https 可正常读取。content 中 img src 必须是带引号的 HTTPS 地址。不要绕过域名校验，不擅自删未知查询参数。
3. 调用 wechat_create_draft，articleType=news，另提供静态 thumbMediaId 或 coverImageUrl。正文引用微信 GIF URL，不把原始外部 GIF URL直接放进去走 inline 导入。
4. 回读 news_item[0].article_type=news 及 content 中的GIF引用。本次后台正文能显示该图片，但四帧截图均为同一帧，不能宣称编辑器动效通过。手机/公开页动画仍未验证，不能据此承诺正式发表播放。

~~~json
{
  "requestId": "REPLACE_NEWS_STABLE_REQUEST_ID",
  "confirmDraft": true,
  "articles": [{
    "articleType": "news",
    "title": "图文正文动图示例",
    "thumbMediaId": "REPLACE_STATIC_PERMANENT_MEDIA_ID",
    "content": "<p>实际正文。</p><img src=\"https://mmbiz.qpic.cn/REPLACE_WECHAT_GIF_PATH\">"
  }]
}
~~~

## 网页视频与播客：本轮实际操作路线

这些步骤是84已登录账号的受信任维护操作，目前不是远程MCP专用创建工具。现有wechat_create_draft不接受video/audio类型、videoUrl或audioUrl。工作流Supabase配置尚未增加这两种草稿节点，不能用通用任意点击伪装已交付的正式工作流。

视频素材路线：主页“视频”→素材选择窗口“本地上传”→独立视频素材页→上传6秒H.264/AAC MP4→等待上传成功→选择一张推荐封面→封面裁剪窗口“完成”→填写素材标题及确认上传规则→点“保存”。必须实际选定封面，仅生成6张候选时保存会提示“请设置封面”。“保存并发表”是不同按钮，本轮没有使用。素材保存后到素材库确认同标题及状态，等待转码后重新打开视频选择窗口，不能依赖旧窗口缓存。

播客素材路线：主页“播客”→“上传音频”→上传12秒MP3→选择“使用账号头像”作测试封面→确认上传规则→等待上传结束后再填写素材标题→“保存”。上传完成可能用文件名覆盖先前填入的标题，必须在保存前回读。素材库已返回同标题、12秒和转码中状态，再等待完成后插入草稿。

以上只覆盖本轮样例，不承诺1小时视频、1GiB音频或页面列出的所有编码格式均已实测。正式提交发表不在本轮验收范围。

本轮保存回执：
- 视频：《视频草稿验证（勿发布）》，网页appmsgid=100001408；官方草稿media_id=3UL3H6nAAGfSe70jlkoNLHvgnYhdGTGqiwhE_KPkHwM5wLFzn7Ocg6ssEpw6miK1。
- 播客：《播客草稿验证（勿发布）》，网页appmsgid=100001409；官方草稿media_id=3UL3H6nAAGfSe70jlkoNLHPnV5USnfl7vCW8sjnYIUflJEbT5s807SMXe-sYIzqP。
- 两类在官方草稿列表里都返回article_type=news，未返回完整音视频字段；不能仅凭这个字段证明媒体类型，也不要把正文为空当成媒体丢失。需要结合精确网页ID、标题、重新打开的原生媒体编辑器核对。
- 视频选择窗口中，实际点击卡片的视频遮罩层完成选中，再点击“确定”；仅点击标题不会选中，底部确认仍禁用。播客点击本轮素材标题后“插入”。
- 插入媒体后填写草稿标题，点击“保存为草稿”，检查operate_appmsg成功回执和appMsgId，随后用同ID重新打开。公开“发表”未点击。

重新打开验证已完成：视频同appmsgid与标题保留，原生视频介绍/视频贴片界面仍在，页面含视频标识wxv_4760536732620472328；播客同appmsgid与标题保留，并显示12秒和音频时间轴入口。官方列表与原生编辑器两路核对通过。本轮没有把播放器最终播放、手机预览或正式发表算作验收通过。
