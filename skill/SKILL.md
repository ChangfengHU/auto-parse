---
name: vyibc-视频解析
description: 解析抖音、小红书视频链接，自动去水印并上传到 OSS，返回永久可访问地址。当用户粘贴抖音或小红书分享链接、要求下载视频、去水印、存到OSS时触发。
---

调用 `https://parse.vyibc.com/api/parse` 完成视频解析和 OSS 上传。

## 接口说明

```
POST https://parse.vyibc.com/api/parse
Content-Type: application/json

{
  "url": "<用户提供的链接或完整分享文本>",
  "watermark": false
}
```

**watermark 参数**（仅抖音生效）：
- `false` = 无水印模式，使用 Playwright + Cookie 解析，约 25 秒
- `true`  = 有水印快速模式，约 3 秒
- 小红书固定无水印，忽略此参数

## 触发规则

用户提供以下内容时自动触发：
- 含 `v.douyin.com` 的抖音链接或分享文本
- 含 `xiaohongshu.com` / `xhslink.com` 的小红书链接
- 用户说"解析视频"、"去水印"、"下载视频"、"存OSS"等

默认使用 `watermark: false`（无水印）；
用户明确说"快速"或"不用去水印"时改用 `watermark: true`。

## 调用步骤

1. 从用户输入中提取完整 URL 或分享文本
2. 判断平台（抖音 / 小红书）
3. 调用接口，等待响应
4. 向用户展示结果

## 响应字段说明

| 字段 | 说明 |
|------|------|
| `ossUrl` | OSS 永久地址，**优先展示给用户** |
| `videoUrl` | 原始 CDN 地址（短效，备用） |
| `title` | 视频标题/文案 |
| `watermark` | `false` = 无水印，`true` = 有水印 |
| `platform` | `douyin` / `xiaohongshu` |

## 向用户输出示例

解析成功后按以下格式回复：

```
✅ 解析成功（无水印）

📌 标题：{title}
🔗 OSS 地址：{ossUrl}
🏷️ 平台：抖音 | 视频ID：{videoId}
```

## 错误处理

| 错误信息 | 处理方式 |
|---------|---------|
| Playwright 超时 | 告知用户 Cookie 可能过期，本次降级为有水印模式并重试 |
| 未找到有效的抖音分享链接 | 请用户重新粘贴链接 |
| 视频已删除 / 需要登录 | 告知用户该视频无法获取 |
| 暂不支持该平台 | 告知目前支持抖音、小红书，B站/微博开发中 |
