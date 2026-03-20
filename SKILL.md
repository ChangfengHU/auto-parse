# 视频解析 & 一键发布 Skill

调用 `https://parse.vyibc.com` 完成两类任务：
1. **解析视频**：抖音/小红书/TikTok 去水印解析 + 上传 OSS，返回永久地址
2. **发布到抖音**：将 OSS 视频一键发布到抖音账号（Playwright 自动化）

---

## 触发时机

### 解析视频
- 用户提供抖音/小红书/TikTok 分享链接或含链接的分享文本
- 说"解析视频"、"去水印"、"下载视频"、"存到OSS"

### 发布到抖音
- 用户说"发布到抖音"、"上传到抖音"、"把这个视频发到我的抖音"
- 有 `ossUrl` 且用户明确要发布

---

## 解析接口

```
POST https://parse.vyibc.com/api/parse
Content-Type: application/json

{
  "url": "<用户提供的链接或分享文本>",
  "watermark": false
}
```

**参数说明**
- 抖音默认 `watermark: false`（无水印，~25s）；用户要"快速"时用 `true`（~3s）
- 小红书/TikTok 忽略 `watermark`，固定无水印

**成功响应**
```json
{
  "success": true,
  "platform": "douyin",
  "videoId": "7590273602331816806",
  "title": "视频完整文案（含话题标签）",
  "videoUrl": "原始CDN地址（短效）",
  "ossUrl": "https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/xxx.mp4",
  "watermark": false
}
```

> **注意**：抖音/TikTok 的 `title` 字段是视频完整文案（`desc`），无独立标题和正文之分。建议发布时取前30字作标题，其余作正文。

**向用户展示**：优先展示 `ossUrl`（永久地址），注明是否有水印

---

## 发布接口（SSE 流式）

```
POST https://parse.vyibc.com/api/publish
Content-Type: application/json

{
  "videoUrl": "OSS视频地址或公开MP4直链",
  "title": "发布标题（最多30字，自动截断）",
  "description": "正文内容（可选，完整文案，可含换行和表情）",
  "tags": ["话题1", "话题2"]
}
```

响应为 SSE 事件流，每行格式：`data: {"type":"log"|"qrcode"|"done"|"error","payload":"..."}`

| type | 说明 |
|------|------|
| `log` | 实时进度日志 |
| `qrcode` | base64 图片，Cookie 过期时提示扫码 |
| `done` | 发布成功 |
| `error` | 发布失败，payload 为错误信息 |

**发布流程**（自动完成，约 2-3 分钟）：
1. 下载视频到本地临时文件
2. 无头浏览器打开抖音创作者中心
3. 若 Cookie 失效 → 推送二维码 → 等待用户扫码 → 自动保存新 Cookie
4. 上传视频文件（Checkpoint 1：确认上传成功）
5. 填写标题（Checkpoint 2：验证填写正确）
6. 确认封面（Checkpoint 3：自动选封面）
7. 实时监控检测进度（Checkpoint 4：等待100%）
8. 点击发布 → 确认审核中

---

## 示例对话

**用户**：帮我解析这个抖音 https://v.douyin.com/m7Tw65kygH8/

**助手**：
1. 调用 `/api/parse`（`watermark: false`）
2. 返回：✅ 解析成功（无水印）
   - 文案：心怎么变 都是偏向你 #情感 #治愈
   - OSS地址：https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/xxx.mp4

---

**用户**：把这个视频发布到我的抖音，标题叫"治愈系短片"

**助手**：
1. 调用 `/api/publish`（SSE流式读取）
2. 实时显示进度日志
3. 若弹出二维码，提示用户扫码
4. 返回：🎉 发布成功，已提交抖音审核

---

## 错误处理

| 错误 | 处理方式 |
|------|---------|
| Cookie 过期（解析时） | 降级为有水印模式，告知用户 |
| Cookie 过期（发布时） | 推送 qrcode 事件，等用户扫码继续 |
| 视频已删除 | 告知用户视频不存在 |
| 平台不支持 | 当前支持抖音/小红书/TikTok，B站/微博待开发 |
| 并发冲突 | 提示"上一个发布任务正在进行中" |
| 内容违规 | 告知检测未通过，建议修改视频内容 |
