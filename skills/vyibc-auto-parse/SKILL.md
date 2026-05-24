---
name: vyibc-auto-parse
description: 解析抖音、小红书视频链接，自动去水印并上传到 OSS/Supabase/R2，返回永久可访问地址。当用户粘贴抖音或小红书分享链接、要求下载视频、去水印、存到OSS/R2时触发。
---

## 抖音无水印解析（重要）

默认 `watermark=false` 时，服务端走 **Playwright + 有效抖音 Cookie** 拦截 `aweme_detail`，从多条 CDN 流中**排除带 Logo 后缀的流**（`download_suffix_logo_addr` / `playwm`），优先选最高码率干净流，再上传到配置的存储。

| 条件 | 结果 |
|------|------|
| 无 Cookie | 降级 `playwm`，`watermark: true`，约 3s |
| 有 Cookie，Playwright 未安装/失败 | 同上，有水印 |
| 有 Cookie + Playwright 正常 | 尽量无水印，约 10–30s |
| 抖音标记 `has_watermark: true` 的视频 | 可能仍有平台水印，不保证 100% |

**Cookie 来源（任选其一）：**
- 服务端平台登录：`.douyin-cookie.json` / 环境变量 `DOUYIN_COOKIE`
- 发布页扫码登录后自动写入
- 解析页「导出配置 → 指定登录 → 粘贴 Cookie」
- 插件凭证 `dy_xxxxxxxx`（从 Supabase `douyin_sessions` 表读取，需 `SUPABASE_URL` 指向含该表的项目）

**Playwright 依赖：**
```bash
npx playwright install chromium
```

## 使用方式

调用 `scripts/parse.sh` 脚本（默认请求 `https://parse.vyibc.com`，本地调试可设 `PARSE_API_BASE=http://localhost:1007`）：

```bash
# 无水印模式（默认，需服务端已配置 Cookie + Playwright）
bash scripts/parse.sh "<链接或分享文本>"

# 有水印快速模式（约 3s，无需登录）
bash scripts/parse.sh "<链接或分享文本>" true
```

**通过环境变量指定登录（无水印时推荐）：**
```bash
# 方式 1：直接传 Cookie
export DOUYIN_COOKIE='sessionid=xxx; uid_tt=xxx; ...'
bash scripts/parse.sh "<链接>"

# 方式 2：插件凭证
export PARSE_CLIENT_ID='dy_xxxxxxxx'
bash scripts/parse.sh "<链接>"

# 方式 3：指定导出到 R2
export PARSE_EXPORT_PROVIDER='r2'   # oss | supabase | r2
bash scripts/parse.sh "<链接>"
```

## API 直接调用

```bash
curl -X POST "${PARSE_API_BASE:-https://parse.vyibc.com}/api/parse" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://v.douyin.com/xxxx/",
    "watermark": false,
    "auth": {
      "mode": "custom",
      "type": "cookie",
      "cookieStr": "sessionid=xxx; ..."
    },
    "export": {
      "provider": "r2",
      "r2": {
        "uploadUrl": "https://upload-r2.vyibc.com",
        "token": "yt-research-token-2026",
        "domain": "https://skill.vyibc.com",
        "path": "douyin"
      }
    }
  }'
```

`auth.mode`: `platform`（服务端默认登录）| `custom`（配合 `type: cookie` 或 `type: credential` + `clientId`）

## 触发规则

用户提供以下内容时自动触发：
- 含 `v.douyin.com` 的抖音链接或分享文本
- 含 `xiaohongshu.com` / `xhslink.com` 的小红书链接
- 用户说「解析视频」「去水印」「下载视频」「存 OSS/R2」等

默认使用无水印模式；用户明确说「快速」或「不用去水印」时传第二个参数 `true`。

## 执行步骤

1. 从用户输入中提取完整 URL 或分享文本
2. 若需无水印，确认服务端有有效 Cookie（或设置 `DOUYIN_COOKIE` / `PARSE_CLIENT_ID`）
3. 运行脚本：`bash scripts/parse.sh "<url>" [true|false]`
4. 将结果中的 `ossUrl`（永久地址）、`title`、`watermark` 展示给用户

## 脚本输出说明

| 字段 | 说明 |
|------|------|
| `ossUrl` | 永久存储地址（OSS / Supabase / R2），优先展示 |
| `videoUrl` | 原始 CDN 地址（短效） |
| `title` | 视频标题/文案 |
| `watermark` | `false`=无水印路径，`true`=playwm 有水印 |
| `uploadProvider` | `oss` / `supabase` / `r2` |
| `authSource` | `platform` / `custom_cookie` / `custom_credential` |
| `platform` | `douyin` / `xiaohongshu` |

## 错误处理

| 错误信息 | 处理方式 |
|---------|---------|
| Playwright 超时 / Executable doesn't exist | 执行 `npx playwright install chromium`；或检查 Cookie 是否过期 |
| 未找到有效的抖音分享链接 | 请用户重新粘贴完整链接 |
| Cookie 中未找到 sessionid | 重新登录或粘贴完整 Cookie |
| Supabase 中不存在 douyin_sessions 表 | 检查 `SUPABASE_URL` 是否与插件写入的项目一致 |
| 插件凭证 404 / 未找到 | 确认 `dy_xxx` 已在 Supabase 同步，或改用 Cookie |
| 暂不支持该平台 | 告知目前支持抖音、小红书，B站/微博开发中 |
