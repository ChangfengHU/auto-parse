# 工作流执行

先读 targets.json选择该自媒体平台的MCP，再用该连接的workflow_get读取最新定义。账号以实际保护节点参数为准，不把示例流程当任意账号通用流程。发布连接不提供流程编辑工具；改账号需通过所有者独立维护连接验证登录身份，经正式copy后改副本并更新允许列表，不改冻结原件。

## 工具顺序

1. 在目标平台连接调用workflow_capabilities({})；workflow_list只列该平台批准流程，不含其他平台和研究任务。
2. workflow_get({workflowId})；核对vars、目标账号及directPublish条件。
3. workflow_open_session({workflowId,browserInstance,vars,confirmBrowserControl:true})。vars的值全部为字符串。账号控制须在任务授权内。
4. workflow_run_step({sessionId,expectedRevision,requestId,confirmExecution:true})逐步执行，或workflow_run同样参数执行剩余节点。操作requestId与内容requestId分开稳定保存。预览阶段用directPublish:"false"；只有本次用户授权公开发布才用"true"。
5. workflow_get_session({sessionId,includeScreenshot:false})轮询，必要时includeScreenshot:true实际审图；按返回sessionRevision继续，不猜修订号。
6. 在原平台连接workflow_close_session({sessionId})释放任务。会话按平台绑定，不能在其他平台或通用端点转接。遇到未知结果先读取原任务证据，勿盲目新建。

完成节点不能在同一会话重放或修改。false分支完成后currentStep可能已跳过发布节点；如需后来公开发布，先核实准备证明是否仍可用于正确节点，不能把false改true后直接从头重跑。不在本插件中添加独立发布脚本。

## 输入

### X文字
expectedUsername、text、requestId、directPublish。expectedUsername是稳定@用户名；text不得包含未解析模板。仅单条推文，不支持回复、引用、视频、线程、定时。启用Post按钮是账号当前长度检查，不把本地10000 UTF-8字节上限称为平台字数上限。

### X单图
额外imageUrls，值为单个HTTPS地址或JSON数组字符串；最多一张PNG/JPEG/WebP，5MiB，只接受resource.vyibc.com或cdn.vyibc.com。上传后要有FINALIZE媒体ID、加载的预览和同一会话proof；创建回执必须匹配上传媒体ID和正文。账号+正文是去重键，换图URL或requestId不能绕过。
x_publication_status({expectedUsername,text,requestId,imageUrls})只读；imageUrls需与原意图一致。published仅代表保存的创建证据；submitting表示未知不可重试。单图真实创建与登录链接回查已验证，匿名可见性和推荐曝光未验收。

### 小红书视频
videoUrl、title、description、requestId、directPublish。当前示例流程绑定固定账号与aiGenerated:true；非AI素材不直接套用这个绑定。false分支保存并回读当前浏览器本地草稿，清理浏览器数据会丢失；true分支才执行带xhsPublication保护的点击及管理页回查。未提供通用定时/私密/多账号派发功能。
已实测视频发布及创作者列表回查；该浏览器的部分MP4本地预览编码不支持，上传通过不等于本地可播放。

### 抖音／小红书图文
imageUrls、title、description、aiGenerated、requestId、directPublish。aiGenerated必须明确"true"/"false"；1–9张有序PNG/JPEG/WebP，单张10MiB，总50MiB，只接受resource.vyibc.com或cdn.vyibc.com；title最多20字符，description最多900字符。使用image_upload和image_text_publish节点，aiGenerated声明必须与实际素材一致。
false分支停在准备页，不保证云草稿保存；true分支公开立即提交。原生话题实体、独立封面、背景音乐、定时/私密尚未支持。两平台真实准备已验收，公开图文创建尚未验收，不为封装插件另发测试内容。

## 故障边界

browser_reserved表示被占用，不清别人的锁。账号不匹配、上传不完整、preview变化或声明不一致时停止。业务成功须检查history里的具体结果，不能只看HTTP200、流程结束或截图成功。
调试会话不跨重启保留；.data下各平台发布意图/回执由服务维护，不删除当缓存。无对应持久查询MCP时只能说明恢复待维护核对，不伪称存在新工具。
