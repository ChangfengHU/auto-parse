# 抖音视频专用路线

服务器auto-parse-douyin-publish，端点https://auto-parse-v2.vyibc.com/api/publish/mcp/douyin。先tools/list定位真实前缀，读取workflow_capabilities.video。与抖音图文同属此平台MCP；不包含研究/采集工具。此平台直接复用84上经批准的Supabase视频适配器，不转调另一个平台端点、不复制发布实现。不要把受保护视频流程放进普通工作流调试器，也不使用旧publish.sh。

1. 复用当前任务已经确认的抖音稳定账号ID，服务在每次准备/发布中重新验证浏览器真实登录身份；无法确认时说明缺少accountId。该发布MCP不提供全机群账号扫描或登录工具，不用研究MCP补扫用户账号。
2. prepare_video输入accountId、videoUrl、title、requestId、aiGenerated，按需description、topics、cover。先读live schema。accountId是平台稳定ID，不是昵称；不传Cookie或clientId。
3. publish_video另需confirmPublish:true，必须对应本次内容/账号的公开发布授权。沿用稳定requestId。不能为了测试认证调用publish。
4. get_video_task({taskId})查原任务。submitted/published的含义以实际回执为准，不当作审核通过。
5. submission_unknown先核对原taskId和平台精确awemeId；reconcile_video_task({taskId,awemeId})只对账不再上传，但仍访问账号，应在原任务授权内。该端点不提供Fleet作品补登记工具，所需后续登记由原维护入口处理。

当前能力：标题30字、正文900字、最多5个话题。topics是caption_text，不保证平台原生话题实体。封面支持竖版与横版JPG/PNG，已真实验证到编辑器保存与预览；公开作品封面需另行回读。上传保持原视频字节，当前本地上限512MiB、256KiB磁盘分块；此数值是实现限制，不代表平台官方最大限额。
真实创建回执与任务查询路线已验证，仍须每次核对账号、声明和新任务结果。

## 视频作品中心与永久留存（抖音 MCP 0.3.0）

页面 https://auto-parse-v2.vyibc.com/video-works 是已投递作品入口，区别于 /materials 解析素材。默认显示已取得真实发布回执的视频，可切换草稿、已准备、失败与未知状态。一个视频保留各平台投递历史。

- 抖音使用 list_video_works({query?,state?,accountId?,offset?,limit?}) 和 get_video_work({workId}) 查询永久档案。返回原视频来源、原片是否已保留、各次请求与回执；只返回抖音范围。先查档案再判断是否需要重新投递，查询不发布。
- get_video_task 在七天任务缓存失效时回查永久回执；workflowExecution:null 表示只有档案，没有可恢复运行的任务。不能把缓存过期当作没发布，更不能换 requestId 重发。
- 原片上传前按实际SHA256保留，不压缩；同内容可归并，源URL保留。源链接失效时可使用保存的原件；未备份的历史来源会明确显示。当前备份位于服务持久磁盘，不宣称异地副本或无限存储。
- 作品页可准备抖音发布页、创建公众号视频草稿。抖音 prepare_video 仍不等于保存云草稿；公众号 draft_saved 需要实际保存与原生编辑器重新打开核对。页面专用授权侧栏支持核对后的抖音公开提交；准备页本身仍不等于发布。
- 作品中心的列表、详情、原片和封面按所有者要求直接查看，无需安全连接；Fleet小工具提供直接跳转。准备、保存草稿和发布仍由已有授权MCP执行；公开查看不授予账号操作权限，平台凭据仍不可互换。
- 小红书已有原发布工作流，但作品中心转投适配尚未完成；X尚不支持视频；视频号未接入。不可将公众号当作视频号。
- 历史回补只读取已有任务和回执，不代表重新发布；有创建回执仍不等于当前审核通过或公开可见。测试稿、失败和未知记录必须如实显示。

0.3.0：prepare_video/publish_video可使用workId继承目标账号的渠道标题、正文、topics和cover；显式空正文/空数组/cover={}可清空继承值，仍需稳定accountId、requestId、真实aiGenerated和发布确认。直接videoUrl+title兼容保留；参数冲突或不支持项拒绝。返回publicationInput完整快照并写同一作品台账。页面非模态侧栏与MCP共用解析器，准备页仍非抖音云草稿。

## 0.3.1：发布窗口与提交前核验

任务页固定1440×1000桌面视口，不继承VNC小窗口。prepare_video也必须等内容检测通过，并执行发布按钮的scroll与trial可点击检查；trial不派发点击，不公开发布。prepared返回publishControlActionable=true及viewport，只代表当次页面通过，不保证稍后仍然可发布。

get_video_task的failureDiagnostic返回stage、category、submissionState和viewport。publication_control_not_actionable且not_submitted表示按钮检查受阻，未点击、未预留发布意图；先解决布局/遮挡或页面校验。unknown表示已经进入可能提交阶段，只查原任务、原账本和真实作品，不得换requestId重发。历史没有诊断的错误不能反推not_submitted，旧submitting记录不会被本次修复自动清空。

## 0.3.2：自定义横竖封面

传入 cover.verticalUrl（3:4）和/或 cover.horizontalUrl（4:3）；两张可同时传。仅接受 resource.vyibc.com / cdn.vyibc.com 的 HTTPS JPG/PNG，每张最多8MiB，不带查询参数。本机路径不能直接传入；先通过已授权上传服务取得地址。仅传一张不会擅自用另一张图片补齐；不传沿用渠道方案，cover={}清空继承后使用平台默认。

示例（其他必填字段按 live schema 提供）：
```json
{"cover":{"verticalUrl":"https://resource.vyibc.com/example-3x4.jpg","horizontalUrl":"https://resource.vyibc.com/example-4x3.png"}}
```

准备和正式发布共用同一个封面适配器：按横竖标签定位，使用原生封面上传框，与AI参考图上传隔离；处理保存后的可选双封面推荐，逐张核对弹窗已确认且对应预览改变，第二张不能覆盖第一张。自动化不替图片设计文字，也不保证任意比例素材裁切美观，建议预先按目标比例设计。

get_video_task.prepared.cover 回显实际应用的图片地址，coverVerification 按 vertical/horizontal 返回 sha256、bytes、previewChanged、dialogConfirmed。正式提交前封面失败会停止，failureDiagnostic.cover 返回 orientation、stage、code，submissionState=not_submitted。不可把图片参数被接受、页面上原本有图或准备完成当作公开作品封面已验收。

2026-11-21 已通过真实正式工作流的 JPG竖封面 + PNG横封面同时应用、弹窗处理、两个独立预览、AI声明和发布按钮trial验证；没有公开发布测试片。prepare_video 仍不是云草稿保存，公开作品封面及审核结果须真实发表后另行回查。

本次在编辑器观察到合集、谁可以看、保存权限、定时发布、视频章节、关联热点和同时发布选项；它们尚未接入本MCP，不得按已支持调用或通过任意点击替代受保护发布流程。

## 0.4.0：发布设置与作品回读

prepare_video / publish_video 新增可选 settings 对象：
```json
{"settings":{"visibility":"public","allowDownload":false,"collectionName":null,"scheduledAt":null}}
```
visibility 为 public / friends / private；allowDownload 控制允许保存；collectionName 为已有且名称唯一的合集名称，null 清空；scheduledAt 为包含明确时区、秒数为00的RFC3339时间，null 立即发布。省略settings保持旧调用语义；显式settings对象未填字段使用公开、允许保存、无合集、立即发布。其他平台同时发布被关闭，不擅自跨平台投递。

定时窗口为执行时2小时以后至14天以内。服务把绝对时间转换为任务浏览器实际时区，回传timeZone、displayedTime和scheduledAt，禁止把机器本地时间当用户时区。定时仅完成编辑器设置验收，尚未做真实预约提交与到时公开验收；若创建接口受理且取得作品ID，返回scheduled，与published区分，均不代表审核通过或匿名可见。

每项设置通过原生label操作并核对data-checked，不相信页面旧input的checked属性。设置失败在提交前停止；failureDiagnostic.settings提供field、stage、code。settingsVerification留存最终设置和核验结果，publicationInput也保留本次完整输入，纳入防重指纹。历史未传settings的指纹不改变。

合集按已有精确名称选择，重名或不存在会停止，不自动创建、不模糊选第一项。当前账号真实测试只观察到“不选择合集”；正向加入已有合集尚未验收。collectionOptions仅为当次可见选项，complete=false，不代表全量。此限制不妨碍其他设置和无合集发表。

新增get_video_publication({accountId,awemeId})，核对账号后读取最近作品页中的精确ID，返回原生封面、可见/审核状态、保存权限和上游暴露的合集信息；不存在于这一页不等于从未发布，不允许据此换ID重发。它不编辑、删除或重发，也不冒充未登录公众可见性验证。

发布测试作品需用户授权；本次已获得“发布一个供检查，由用户手动删除”的授权。测试稿明确标为功能验证，不将测试结果当日常内容发表。

浏览器忙或明确not_submitted失败可调用retry_video_task({taskId,confirmRetry:true})，服务保留原内容、账号、requestId并返回替换taskId。原taskId重复调用复用同一替换任务；已有提交意图、unknown和无法证明未提交的失败均拒绝，不开放覆写内容。等待浏览器空闲后重试，不强占其他正式任务。

2026-11-21已通过MCP实际创建一条明确标记的测试作品，原生创建回执及创作者列表回读均确认：公开设置、禁止保存、自定义主封面正确。横竖封面均在提交前核验通过；未进行未登录访客播放验收。忙碌和AI声明前置失败分别安全沿用原requestId恢复，旧taskId重复重试回读同一成功任务，不重复发表。测试作品由用户手动删除，不作为长期可访问示例。

### 查询合集（MCP 0.4.1）

调用 `list_collections({accountId})`，返回已核验创作者账号的后台合集首屏。用返回的精确 `name` 填入 `publish_video.settings.collectionName`。若 `complete:false`，首屏缺失不能证明合集不存在。合集加入实发仍需正向验收。

创建空合集（MCP 0.4.2）：使用 create_collection，传 accountId、name、confirmCreate:true，可选 description。工具自动生成方形文字封面，同名且可核对时复用，平台将新建空合集标为待发布。若提交结果未知，先用 list_collections 对账。

合集封面（MCP 0.4.3）：创建时可传 coverUrl；省略沿用自动标题封面。已有合集先 list_collections 取得 collectionId，再用 update_collection_cover({accountId,collectionId,coverUrl,confirmUpdate:true})。图片为自有 resource/CDN HTTPS JPG 或 PNG，最多 5 MiB，不允许跳转。编辑器保存后重新打开核对封面；结果未确认时先查后台。
