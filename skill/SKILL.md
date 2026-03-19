---
name: vyibc-视频解析
description: 解析抖音、小红书视频链接，自动去水印并上传到 OSS，返回永久可访问地址。当用户粘贴抖音或小红书分享链接、要求下载视频、去水印、存到OSS时触发。
---

## 使用方式

调用 `scripts/parse.sh` 脚本完成解析：

```bash
# 无水印模式（默认，约25s）
bash scripts/parse.sh "<链接或分享文本>"

# 有水印快速模式（约3s）
bash scripts/parse.sh "<链接或分享文本>" true
```

## 触发规则

用户提供以下内容时自动触发：
- 含 `v.douyin.com` 的抖音链接或分享文本
- 含 `xiaohongshu.com` / `xhslink.com` 的小红书链接
- 用户说"解析视频"、"去水印"、"下载视频"、"存OSS"等

默认使用无水印模式；用户明确说"快速"或"不用去水印"时传第二个参数 `true`。

## 执行步骤

1. 从用户输入中提取完整 URL 或分享文本
2. 运行脚本：`bash scripts/parse.sh "<url>" [true|false]`
3. 等待脚本输出结果
4. 将结果中的 OSS 地址、标题展示给用户

## 脚本输出说明

| 字段 | 说明 |
|------|------|
| `ossUrl` | OSS 永久地址，优先展示 |
| `videoUrl` | 原始 CDN 地址（短效） |
| `title` | 视频标题/文案 |
| `watermark` | `false`=无水印，`true`=有水印 |
| `platform` | `douyin` / `xiaohongshu` |

## 错误处理

| 错误信息 | 处理方式 |
|---------|---------|
| Playwright 超时 | Cookie 可能过期，告知用户，改用 `true` 快速模式重试 |
| 未找到有效的抖音分享链接 | 请用户重新粘贴完整链接 |
| 暂不支持该平台 | 告知目前支持抖音、小红书，B站/微博开发中 |
