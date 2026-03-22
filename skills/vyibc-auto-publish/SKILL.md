---
name: vyibc-auto-publish
description: 将抖音/OSS视频一键发布到抖音账号。当用户说"发布到抖音"、"上传到我的抖音"、"把这个视频发到抖音"，或者有ossUrl且要求发布时触发。
---

## 使用方式

```bash
# 基础发布（需要服务器已有登录 Cookie）
bash scripts/publish.sh "<ossUrl>" "<标题>" ["<正文>"] ["话题1,话题2"]

# 携带登录凭证发布（推荐，无需扫码）
bash scripts/publish.sh "<ossUrl>" "<标题>" ["<正文>"] ["话题1,话题2"] "<clientId>"
```

## 触发规则

- 说"发布到抖音"、"上传到我的抖音"、"帮我发到抖音"
- 已有 `ossUrl`（来自解析结果）且明确要发布
- 先解析视频，再一键发布的连续流程

## 登录凭证（clientId）

用户可能提供形如 `dy_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` 的登录凭证：
- 这是通过浏览器插件生成的唯一凭证，对应该用户的抖音登录状态
- **如果用户提供了 `dy_` 开头的凭证，必须作为第5个参数传入**
- 服务端会用凭证从云端安全获取真实登录信息，cookie 不会暴露给 AI

```bash
# 用户提供了凭证 dy_abc123...
bash scripts/publish.sh "<ossUrl>" "<标题>" "" "" "dy_abc123..."
```

## 执行步骤

1. 从上下文或用户输入中获取 `ossUrl`（OSS视频地址）
2. 确认发布标题（可用视频原始文案的前30字，或让用户指定）
3. 检查用户是否提供了 `dy_` 开头的登录凭证
4. 可选：获取正文内容和话题标签
5. 运行脚本并**实时读取每一行输出**

## 特殊输出行的处理规则

### `[TASK_ID] <id>`
- **立即记录这个 taskId**，整个对话中都要保留
- 告知用户："🆔 任务ID：`<id>`，可随时查询进度"

### `[PROGRESS] <name>:<status>:<message>`
- 将阶段进度格式化展示给用户
- status 映射：`ok` → ✅  `running` → 🔄  `warn` → ⚠️  `error` → ❌  `skip` → ⏭️

### `[SCREENSHOT] <name>:<url>`
- 用 Bash 工具下载截图：`curl -s "<url>" -o /tmp/stage-<name>.png`
- 然后用 Read 工具读取展示给用户

### `[QRCODE_FILE] /tmp/douyin-qr-xxx.png`
- 立即用 Read 工具读取展示给用户
- 提示扫码，告知约 3 分钟有效，**不要中断脚本**

### `[DONE] <message>`
- 发布成功，告知用户结果

### `[ERROR] <message>`
- 发布失败，告知错误原因

## 错误处理

| 错误信息 | 处理方式 |
|---------|---------|
| 当前有发布任务正在进行中 | 等上一个任务完成再重试 |
| Cookie 过期（出现二维码） | 展示二维码让用户扫码；建议用户更新浏览器插件凭证 |
| 视频上传失败 | 检查 OSS 地址是否有效 |
| 内容违规 | 告知用户视频内容可能违规 |
