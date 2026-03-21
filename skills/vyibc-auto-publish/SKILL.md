---
name: vyibc-auto-publish
description: 将抖音/OSS视频一键发布到抖音账号。当用户说"发布到抖音"、"上传到我的抖音"、"把这个视频发到抖音"，或者有ossUrl且要求发布时触发。
---

## 使用方式

```bash
bash scripts/publish.sh "<ossUrl>" "<标题>" ["<正文内容>"] ["话题1,话题2"]
```

## 触发规则

- 说"发布到抖音"、"上传到我的抖音"、"帮我发到抖音"
- 已有 `ossUrl`（来自解析结果）且明确要发布
- 先解析视频，再一键发布的连续流程

## 执行步骤

1. 从上下文或用户输入中获取 `ossUrl`（OSS视频地址）
2. 确认发布标题（可用视频原始文案的前30字，或让用户指定）
3. 可选：获取正文内容（`description`，可包含换行和表情）
4. 可选：获取话题标签（`tags`，逗号分隔，不含 #）
5. 运行脚本并**实时读取每一行输出**，按下方规则处理特殊行：

```bash
bash scripts/publish.sh "<ossUrl>" "<title>" "<description>" "<tag1,tag2>"
```

## 特殊输出行的处理规则

### `[TASK_ID] <id>`
- **立即记录这个 taskId**，整个对话中都要保留
- 告知用户："🆔 任务ID：`<id>`，可随时查询进度"

### `[PROGRESS] <name>:<status>:<message>`
- 将阶段进度格式化展示给用户，脚本**全程持续输出此行**
- status 映射：`ok` → ✅  `running` → 🔄  `warn` → ⚠️  `error` → ❌  `skip` → ⏭️
- 示例展示格式：
  ```
  ✅ 视频下载
  ✅ 登录检测
  ✅ 注入视频
  🔄 视频上传（上传中...）
  ```

### `[SCREENSHOT] <name>:<url>`
- 用 Bash 工具下载截图：`curl -s "<url>" -o /tmp/stage-<name>.png`
- 然后用 Read 工具读取 `/tmp/stage-<name>.png`，直接内嵌展示给用户
- 展示时注明是哪个阶段的截图

### `[QRCODE_FILE] /tmp/douyin-qr-xxx.png`
- 立即用 Read 工具读取该图片文件展示给用户
- 提示："Cookie 已过期，请用抖音 App 扫描上方二维码登录"
- 告知二维码约 3 分钟有效，扫码后脚本自动继续
- **不要中断脚本**，继续等待后续输出

### `[DONE] <message>`
- 发布成功，告知用户最终结果
- 展示本次所有阶段的完成情况汇总

### `[ERROR] <message>`
- 发布失败，告知用户错误原因，提供排查建议

## 脚本完整输出示例

```
⏳ 开始下载视频到本地...
✅ 视频下载完成
🚀 启动浏览器（无头模式）...
[TASK_ID] 2026-03-22T10-00-00-abc12
📄 上传页就绪
📤 开始上传视频...
[PROGRESS] download:ok:视频下载完成
[PROGRESS] login-check:ok:已登录，上传框可见
[SCREENSHOT] login-check:http://localhost:1007/api/publish/screenshot/.../01-login-check.png
⏳ 上传中... (5s)
✅ Checkpoint 1：视频上传成功
[PROGRESS] cp1-upload:ok:视频上传成功，预览已加载
✏️ Checkpoint 2：标题已填写 → "xxx"
[PROGRESS] cp2-title:ok:标题已填写
🔍 Checkpoint 4：无需内容检测，可直接发布
📡 视频后台上传中... 60%  (8s)
📡 视频后台上传中... 93%  (14s)
✅ 视频上传完成（耗时 18s）
[PROGRESS] upload-complete:ok:后台上传完成，耗时 18s
[SCREENSHOT] upload-complete:http://localhost:1007/api/publish/screenshot/.../10-publish-complete.png
[DONE] 发布成功！视频已提交抖音审核
```

## taskId 的作用

记录的 `taskId` 可传给 vyibc-publish-status skill 查询详细状态：
- 用户之后问"发布成功了吗"时直接用这个 ID 查询
- 可获取每个阶段的截图和详细信息

## 错误处理

| 错误信息 | 处理方式 |
|---------|---------|
| 当前有发布任务正在进行中 | 等上一个任务完成再重试 |
| Cookie 过期（出现二维码） | 用 Read 工具读取图片文件展示给用户扫码 |
| 视频上传失败 | 检查 OSS 地址是否有效，重试 |
| 内容违规/检测不通过 | 告知用户视频内容可能违规，需更换视频 |
| 标题填写失败 | 检查标题是否包含特殊字符，尝试简化标题 |
