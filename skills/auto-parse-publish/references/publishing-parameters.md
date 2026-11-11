# 发布参数映射与调用示例

适用基线：抖音MCP 0.3.0、公众号0.6.0、作品中心0.3.1、X/小红书0.1.1。先读取实际工具表和capabilities；客户端未更新时不要伪造新工具。本文工具名不带客户端连接前缀，按服务器身份定位。

## 字段去向

| 内容 | 作品中心方案 | 抖音视频专用工具 | 公众号原生视频草稿 | 小红书视频工作流 | X文字/单图工作流 |
| --- | --- | --- | --- | --- | --- |
| 作品 | workId | workId或videoUrl+title | workId或旧videoUrl完整参数 | vars.videoUrl | 不支持视频 |
| 目标账号 | platform+accountId | accountId稳定抖音ID | expectedAccount为gh_原始ID，workId路径可推断唯一已核验账号 | 正式流程绑定，不能任意传accountId换号 | vars.expectedUsername |
| 标题 | title | title，省略可继承账号方案 | title，省略可继承账号方案 | vars.title | 无原生title；方案title仅管理用 |
| 正文 | description | description | description | vars.description | vars.text；不要发送title/description充当工具字段 |
| 标签 | topics不带# | topics数组≤5，caption_text非原生话题保证 | 不支持；不传topics | 无独立topics字段；按需在description写#主题 | 按需在text写#主题 |
| 封面 | cover.verticalUrl/horizontalUrl | 同形cover，实验能力 | 不支持自定义；推荐视频帧 | 无独立cover字段 | imageUrls是附图而非封面；最多一张图片 |
| AI属性 | 原片aiGenerated单独保留 | aiGenerated必须据实际来源 | 不支持平台声明参数；响应来源属性不是已声明 | 核对流程固定aiGenerated，非AI内容不能硬套 | 以实际工作流能力核对，不虚构参数 |
| 行为确认 | confirmSave=true只存方案 | prepare_video准备；publish_video需confirmPublish=true | wechat_create_video_draft需confirmDraft=true，只存草稿 | directPublish字符串false/true | directPublish字符串false/true |
| 去重 | 独立固定requestId和expectedRevision | 同发布意图稳定requestId | 复用预检返回或既有原requestId | 内容requestId与执行操作requestId分别保留 | 同左，且账号+正文参与去重 |

原生MCP参数用JSON布尔/数组；workflow_open_session.vars里的值全部是字符串。不要把JSON数组直接塞入工作流vars；例如其imageUrls按需要用JSON数组字符串。原片保留不压缩，不为发布擅自降画质；抖音512MiB是当前实现上限，公众号视频100MiB/H264/可选AAC/3600秒，超限先说明和提供方案。

## 已入库作品的推荐顺序

1. 作品中心get_video_work，确认唯一workId、来源、原片留存和历史回执。
2. 对每个目标分别get_channel_content({workId,platform,accountId?})；保留该目标返回的revision，不拿源渠道revision覆盖目标。
3. 按[channel-copy.md](channel-copy.md)改写。需要保存时调用save_channel_content。作品中心可保存较长方案，不代表目标发布工具接受；仍按目标字段限制校验。
4. 对已授权目标调用对应预检/准备工具；读取publicationInput核对完整正文及platformSettings。方案明确不支持项不能静默吞掉。
5. 原样使用同一份已核对字段调用实际发布/存稿，读取真实回执。若预检后方案或原片变化，重新核对；不提交被另一个账号/渠道覆盖的内容。

优先级：显式传参 > 对应账号方案 > 渠道默认方案 > 对应历史投递 > 作品默认；以解析工具返回的fieldSources为准。workId/videoUrl不一致会被拒绝。抖音显式description:""、topics:[]、cover:{}可清空继承值；公众号显式description:""也保留为空。保存方案是完整内容版本，不是只改标题的局部补丁：先读，再带齐title/description/topics及需保留的cover。

## 例一：为两个渠道分别保存方案

以下是示意数据，不能直接执行。全a的workId、00000000000和gh_000000000000必须换成读取的真实作品及已核验账号；revision=0只适用于该目标查询实际返回0时。所有requestId示例必须为本次授权意图生成稳定值，重试不换号。

作品中心get_channel_content：

~~~json
{"workId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","platform":"douyin","accountId":"00000000000"}
~~~

作品中心save_channel_content（明确授权保存方案后）：

~~~json
{
  "workId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "platform":"douyin",
  "accountId":"00000000000",
  "title":"菜快凉了，手机还没吃饱",
  "description":"我等的是开饭，她等的是光线。你们吃饭前，也有这道流程吗？",
  "topics":["生活日常","吃饭先拍照","情侣日常"],
  "expectedRevision":0,
  "requestId":"demo-copy-douyin-001",
  "confirmSave":true
}
~~~

公众号必须单独get_channel_content({workId,platform:"wechat",accountId:真实gh原始ID})，用这个目标的revision保存：

~~~json
{
  "workId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "platform":"wechat",
  "accountId":"gh_000000000000",
  "title":"一顿饭，手机先吃",
  "description":"菜端上桌，他刚拿起筷子，她举起了手机。\n\n一个想趁热吃，一个想留下最好看的样子。",
  "topics":[],
  "expectedRevision":0,
  "requestId":"demo-copy-wechat-001",
  "confirmSave":true
}
~~~

这只保存作品中心方案，不新建平台草稿，不公开发出。

## 例二：抖音视频

在auto-parse-douyin-publish调用prepare_video；示例aiGenerated:true仅假定素材确实为AI，实际须用真实属性：

~~~json
{
  "workId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "accountId":"00000000000",
  "title":"菜快凉了，手机还没吃饱",
  "description":"我等的是开饭，她等的是光线。你们吃饭前，也有这道流程吗？",
  "topics":["生活日常","吃饭先拍照","情侣日常"],
  "aiGenerated":true,
  "requestId":"demo-publish-douyin-001"
}
~~~

省略字段可以继承方案；为防准备后方案变化，实际发布时显式带回已核对的title/description/topics/cover，保持workId/accountId/aiGenerated/requestId一致，调用publish_video并额外confirmPublish:true。未要求自定义封面可省略；要指定则cover对象仅verticalUrl/horizontalUrl，必须真实自有资源域HTTPS无参数JPG/PNG、≤8MiB，并符合实际比例。prepare不是抖音云草稿。

返回后get_video_task({taskId})；unknown先原任务对账，不能换requestId或修改文案绕过去重。正文不自动添加音乐来源或工具说明，真实AI来源仍按平台能力声明。

## 例三：公众号原生视频草稿

在auto-parse-wechat-publish调用wechat_prepare_video_draft：

~~~json
{
  "workId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "expectedAccount":"gh_000000000000",
  "title":"一顿饭，手机先吃",
  "description":"菜端上桌，他刚拿起筷子，她举起了手机。\n\n一个想趁热吃，一个想留下最好看的样子。"
}
~~~

读取needsAdaptation、真实publicationInput和返回的requestId。用户已要求存稿后，wechat_create_video_draft带同一份workId/expectedAccount/title/description、预检返回的requestId及confirmDraft:true；不要添加topics、cover、aiGenerated、confirmPublish。预检不会保留请求或创建草稿；工具返回needsAdaptation时先语义改写，不截字拼接。已有相同作品账号文案的原请求必须复用。

以wechat_media_draft_status({requestId})轮询；按作品查原请求用wechat_list_video_work_drafts({workId,expectedAccount?})。completed且saveResponseAccepted与nativeEditorReloadVerified均true才报告视频草稿已保存；不称公开发表。视频封面用推荐帧，保存到作品方案的自定义封面不能当成平台已应用。

官方图文/贴图工具是wechat_create_draft的articles、content、digest、thumbMediaId等字段，和上述原生视频工具不同，必须读[完整格式指南](wechat-drafts.md)，不能把短视频描述当HTML正文或把视频草稿限制套给图文。

## 例四：X、小红书与未接入渠道

X：在实际批准工作流内将精简文案放进vars.text，vars.expectedUsername核对稳定账号。text不拆成title/description；本账号默认英文但尊重本次明确要求。仅文字或单图，不上传视频，不承诺一键从作品中心发布视频。

小红书：vars.title与vars.description映射到对应字段，videoUrl与requestId复用实际来源。先workflow_get检查固定账号/AI属性和directPublish条件；不能把作品中心保存的cover/topics当成发布器支持。具体执行、会话修订和确认参数见[工作流执行](workflows.md)。

Instagram/Threads/Facebook/TikTok/视频号：目前可按对应platform保存内容方案，没有本插件发布器；不因方案写好了就调用不存在的发布工具。新增发布器后先核对schema，再补字段映射及真实验收范围。

## 查询跨渠道缺口

“已发抖音、公众号还没同步”：使用独立作品中心MCP完整分页读取各渠道投递，按抖音真实published且目标公众号无已确认draft_saved/published交叉筛选；指定账号时必须同账号口径。不要用抖音专用查询或旧platform单值过滤后推断公众号没有记录，它们可能只返回单平台投影。

当前没有单独的负向渠道排除参数，由Agent对完整记录交叉筛选。unknown/running/reserved单列等待核实，失败记录单列；prepared和只有content_ready都不算公众号草稿。尚无公众号成功记录仅说明作品中心没有相应证据，不证明用户从未手动发表。缺口查询不触发保存或补发；批量补稿需本次用户已授权的目标范围。
