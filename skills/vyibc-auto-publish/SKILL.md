---
name: vyibc-auto-publish
description: 将抖音/OSS视频一键发布到抖音账号。当用户说"发布到抖音"、"上传到我的抖音"、"把这个视频发到抖音"，或者有ossUrl且要求发布时触发。
---

## 执行命令（必须严格按此格式）

```bash
bash scripts/publish.sh "<ossUrl>" "<标题>" "<正文>" "<话题1,话题2>" "<clientId>"
```

**所有5个参数必须传入，没有的填空字符串 `""`，绝对不能省略参数。**

示例：
```bash
# 有凭证
bash scripts/publish.sh "https://oss.../video.mp4" "我的标题" "" "" "dy_cf8b7ec6f2424b7db449f2d7ecf20ae9"

# 有凭证+正文+话题
bash scripts/publish.sh "https://oss.../video.mp4" "标题" "正文内容" "美食,探店" "dy_cf8b7ec6f2424b7db449f2d7ecf20ae9"

# 无凭证（会走扫码流程）
bash scripts/publish.sh "https://oss.../video.mp4" "标题" "" "" ""
```

## 参数提取规则

| 参数 | 来源 |
|------|------|
| ossUrl | 用户提供的 OSS 地址，或解析结果中的视频地址 |
| 标题 | 用户指定，或视频原始文案前30字 |
| 正文 | 用户指定，没有填 "" |
| 话题 | 用户指定（逗号分隔，不含#），没有填 "" |
| clientId | 用户提供的 dy_ 开头凭证，没有填 "" |

**关键：只要用户消息中出现 dy_ 开头的字符串，必须识别为 clientId 并作为第5个参数传入。**

## 触发规则

- 说"发布到抖音"、"上传到我的抖音"、"帮我发到抖音"
- 已有 ossUrl（来自解析结果）且明确要发布
- 先解析视频，再一键发布的连续流程

## 特殊输出行的处理规则

### [TASK_ID] <id>
- 立即记录这个 taskId，整个对话中都要保留
- 告知用户："🆔 任务ID：<id>，可随时查询进度"

### [PROGRESS] <name>:<status>:<message>
- 将阶段进度格式化展示给用户
- status 映射：ok→✅ running→🔄 warn→⚠️ error→❌ skip→⏭️

### [SCREENSHOT] <name>:<url>
- 用 Bash 工具下载：curl -s "<url>" -o /tmp/stage-<name>.png
- 然后用 Read 工具读取展示给用户

### [QRCODE_FILE] /tmp/douyin-qr-xxx.png
- 立即用 Read 工具读取展示给用户
- 提示扫码，约3分钟有效，不要中断脚本

### [DONE] <message>
- 发布成功，告知用户结果

### [ERROR] <message>
- 发布失败，告知错误原因

## 错误处理

| 错误信息 | 处理方式 |
|---------|---------|
| 当前有发布任务正在进行中 | 等上一个任务完成再重试 |
| Cookie 过期（出现二维码） | 展示二维码让用户扫码 |
| 视频上传失败 | 检查 OSS 地址是否有效 |
| 内容违规 | 告知用户视频内容可能违规 |
