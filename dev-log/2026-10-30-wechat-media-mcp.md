# 公众号视频与播客专用MCP草稿

2026-10-30。用户指出网页验证后仍缺专用创建工具，要求继续实现。仅84:/opt/auto-parse开发部署。

## 交付

现有公众号MCP升0.4.0，共24工具，新增wechat_create_video_draft、wechat_create_podcast_draft、wechat_media_draft_status。请求先落600权限持久台账，再异步执行正式Supabase工作流a5844b00-cd7b-442d-9e4f-8a5a18338b82；单节点wechat_media_draft。browser1受非阻塞活动锁保护，核对gh_原始ID，精确点击保存，不开放发表参数。只关闭自己创建的页面与弹窗。

同ID同参数复用，改参数冲突；完成回执跨重启保留，未完成任务重启后unknown，不自动重试未知保存。公共素材限定resource/cdn HTTPS，无查询凭据；下载流量100MiB封顶，用ffprobe验证MP4 H264/AAC或MP3，临时文件finally清理。时长、标题和描述限额属于本地边界，未声称微信最大值全部真实验收。

## 实测

- 视频：requestId=mcp-video-acceptance-20261030-05，6秒/728387字节。网页appMsgId=100001421，wxv_4760634722165506049；官方media_id=3UL3H6nAAGfSe70jlkoNLENH6ctC--DPmWEWdvtYe3EXOxEuYXBVfAb5ruFmww7f。保存响应、硬刷新后标题/描述/视频标识通过。同ID重放相同回执，列表匹配一条。约69秒。
- 播客：requestId=mcp-podcast-acceptance-20261030-04，12.042秒/193141字节。网页appMsgId=100001413；官方media_id=3UL3H6nAAGfSe70jlkoNLAQwdyJkzgCiCSbI5puGggEIMu7mApmsN9dHSdAfN4Pa。保存响应、硬刷新后标题/富文本描述/音频编辑器通过。同ID及服务重启后重放相同回执，列表匹配一条。约42秒。
- 公网21字标题、同ID改标题、内网HTTP素材拒绝；结束后浏览器1锁释放。
- 61项相关测试、TypeScript/生产构建及修改模块lint通过。
- 未公开发表，未验证播放器最终播放、手机预览、长文件或所有格式上限。

## 修复中遇到的真实问题

新编辑窗口DOMContentLoaded不代表素材列表已经挂载；需等待上传入口和目标素材实际可见。音频头像加载与协议勾选存在时序，等封面后再设置标题/确认协议。视频推荐帧裁剪存在初始化阶段，等待图片、窗口与请求；只有尚未发出cropimage请求时才允许再次点击完成，已发出后等窗口关闭，避免重复提交。保留现场实查裁剪成功响应。介绍和描述是可见ProseMirror富文本，不能使用普通placeholder输入框选择器。

失败前几轮没有创建草稿，但有两份调试音频永久素材（标题MCP音频c43c42f50c2c与MCP音频a63f76eea289）保留；其请求台账保留unknown及具体阶段，不伪装成功。早期未保存的视频临时上传不等于永久素材或草稿。测试草稿保留且标明勿发布。

## 部署与恢复

当前构建.next-wechat-media-v040f-20261030，auto-parse.service监听11007；本地健康及公网MCP工具清单已验证。原构建配置备份在.runtime/wechat-media-v040/previous-build.env，对应.next-wechat-gif-v031-20261030。回滚只恢复build.env并在两浏览器锁可获取、任务空闲时重启；保留持久请求台账，不能通过删除台账重放未知保存。回滚版本没有新节点；不要执行新工作流。Supabase配置是正式来源，目录索引不是运行时JSON替代。

Git仅提交本任务文件，不包含其他任务的.materials.json、parse路由、上传模块、音频配置、tsconfig及构建产物。Skill和Hub固定版本发布已完成，回执见下；不自动升级调用方客户端。

## 发布回执

代码提交59bbffb876fe82e1ddc75863761d30609c710f27已立即推送feature/wechat-rea-prepare-20261029。
MCP 0.4.0：98c1d66b-85b2-4564-93b7-793332f7eae0（24工具）；Skill 0.4.0：c72d0d53-1f42-4bdc-806b-ed542c687176；插件0.4.0：2b02ef31-cb8c-48a9-9d3b-b6468fb5b6de。
Skill包8文件，下载SHA256 9fd5cee37c9347357d78e7a6fb951be24d035ba23cb94299feef89c87e8a623d。插件包19项，SHA256 ad851500a46f54e8603b0e0fdf89000cc4beb0773886620c10d343c2282ad4b2，8份Skill文件逐一哈希与发布源一致。Hub卡片及固定依赖版本已回读；未执行客户端安装，也没有向ChatGPT发布。
插件入口：https://fleet.vyibc.com/#/hub?view=plugins&plugin=vyibc-auto-publish
固定包：https://fleet.vyibc.com/api/hub/onboarding/packages/vyibc-auto-publish/0.4.0/archive
安装指南：bash <(curl -fsSL https://skill.vyibc.com/install-auto-parse-publish.sh?ts=20261030082040)
