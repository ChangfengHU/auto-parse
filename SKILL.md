# 视频解析 Skill

调用 `https://parse.vyibc.com/api/parse` 解析抖音、小红书视频，自动上传到 OSS，返回永久可访问地址。

## 触发时机

当用户提供以下内容时触发：
- 抖音分享链接或含链接的分享文本（含 `v.douyin.com`）
- 小红书分享链接（含 `xiaohongshu.com` 或 `xhslink.com`）
- 要求"解析视频"、"去水印"、"下载视频"、"存到OSS"等

## 调用方式

```json
POST https://parse.vyibc.com/api/parse
Content-Type: application/json

{
  "url": "<用户提供的链接或分享文本>",
  "watermark": false
}
```

- 抖音默认用 `watermark: false`（无水印，约25s）
- 用户明确要"快速"或"有水印"时用 `watermark: true`（约3s）
- 小红书忽略 `watermark` 参数，固定无水印

## 响应处理

成功时返回：
```json
{
  "success": true,
  "platform": "douyin",
  "videoId": "7590273602331816806",
  "title": "视频标题",
  "videoUrl": "原始CDN地址（短效）",
  "ossUrl": "https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/xxx.mp4",
  "watermark": false
}
```

**向用户展示时**：
- 优先展示 `ossUrl`（永久地址）
- 说明 `watermark: false` = 无水印，`true` = 有水印
- 标题用 `title` 字段

## 示例对话

**用户**：帮我解析这个抖音 https://v.douyin.com/m7Tw65kygH8/

**助手**：
1. 调用接口（`watermark: false`）
2. 返回：✅ 解析成功（无水印）
   - 标题：心怎么变 都是偏向你
   - OSS地址：https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/xxx.mp4

---

**用户**：快速解析，不用去水印

**助手**：
1. 调用接口（`watermark: true`）
2. 约3秒返回结果

## 错误处理

| 错误 | 处理方式 |
|------|---------|
| Cookie 过期（Playwright 超时） | 告知用户需要更新 Cookie，本次降级为有水印模式 |
| 视频已删除 | 告知用户视频不存在 |
| 平台不支持 | 告知当前支持抖音、小红书，B站/微博待开发 |
