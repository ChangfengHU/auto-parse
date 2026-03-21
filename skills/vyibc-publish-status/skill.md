---
name: vyibc-publish-status
description: 查询抖音发布任务的进度和状态。当用户说"发布进度怎么样"、"查一下发布状态"、"任务id是xxx"、"发布成功了吗"、"看看发布日志"、"任务状态"时触发。
---

## 使用方式

通过 HTTP 接口查询发布任务状态：

```
GET http://localhost:1007/api/publish/status              → 列出最近20条任务
GET http://localhost:1007/api/publish/status?taskId=xxx  → 查询指定任务详情
```

## 触发规则

以下情况触发本 Skill：
- 用户提到 taskId（如 "2026-03-22T17-56-17-abc"）
- 用户问"发布进度"、"发布状态"、"发布成功了吗"
- 用户说"查一下上次发布"、"看看日志"
- 发布脚本已在运行，用户想查看进度截图或扫二维码

## 执行步骤

### 查询单个任务（有 taskId）

1. 调用状态接口：
   ```bash
   curl -s "http://localhost:1007/api/publish/status?taskId=<taskId>"
   ```

2. 解析返回的 JSON，关键字段：
   - `taskId`：任务ID
   - `status`：`running` / `success` / `failed`
   - `needsQrScan`：**true 时表示当前正在等待扫码登录**
   - `latestQrCode`：最新二维码的 base64（`data:image/png;base64,...`）
   - `latestQrUrl`：最新二维码的图片 URL（可直接下载）
   - `checkpoints[]`：各检查点信息：
     - `name`：阶段名
     - `status`：`ok` / `warn` / `error` / `skip`
     - `message`：描述
     - `screenshotUrl`：截图URL（如 `/api/publish/screenshot/{taskId}/screenshots/01-login-check.png`）
   - `logs[]`：日志行数组

3. 展示任务摘要（阶段完成情况，用 ✅ / 🔄 / ❌ / ⏳ 表示）

4. **如果 `needsQrScan === true`，立即展示二维码**（见下方"扫码登录"章节）

5. **展示各阶段截图**：对有 `screenshotUrl` 的 checkpoint：
   ```bash
   curl -s "http://localhost:1007<screenshotUrl>" -o /tmp/stage-<name>.png
   ```
   然后用 Read 工具读取图片展示给用户

### 扫码登录（needsQrScan = true）

当返回数据中 `needsQrScan === true` 时，必须立即让用户扫码：

**方法一（推荐）：下载图片文件后展示**
```bash
curl -s "http://localhost:1007<latestQrUrl>" -o /tmp/douyin-qr.png
```
然后用 Read 工具读取 `/tmp/douyin-qr.png`，Claude Code 会自动内嵌显示图片

**方法二：用 base64 数据写文件**
```bash
# 提取 base64 内容（去掉 data:image/png;base64, 前缀）
echo "<base64内容>" | base64 -d > /tmp/douyin-qr.png
```
然后用 Read 工具读取 `/tmp/douyin-qr.png`

提示用户：
- "Cookie 已过期，请用抖音 App 扫描上方二维码"
- "二维码约 3 分钟有效，扫码后系统自动继续发布"
- "可以每隔 30 秒查询状态，确认登录后 `needsQrScan` 会变为 false"

### 查询任务列表（无 taskId）

1. 调用：
   ```bash
   curl -s "http://localhost:1007/api/publish/status"
   ```

2. 返回最近20个任务数组，每项包含 `taskId`、`status`、`startTime`、`title`

3. 以列表展示，让用户选择要查看的任务

## 阶段说明

| 阶段名 | 说明 |
|--------|------|
| `download` | 视频下载到本地 |
| `login-check` | 检测是否已登录抖音 |
| `login` | 扫码登录（Cookie 过期时才有） |
| `upload-page` | 进入视频上传页面 |
| `video-inject` | 视频文件已注入上传框 |
| `cp1-upload` | 视频上传成功，URL 已跳转到表单页 |
| `cp2-title` | 标题和描述已填写 |
| `cp3-cover` | 封面已自动生成 |
| `cp4-detection` | 内容安全检测通过 |
| `pre-publish` | 发布按钮已点击 |
| `redirect-manage` | 已跳转到作品管理页 |
| `upload-complete` | 视频后台上传完成 |

## 状态图标

- ✅ ok：该阶段已完成
- 🔄 running：正在进行
- ❌ error：失败
- ⚠️ warn：警告（如需扫码）
- ⏭️ skip：跳过

## 错误处理

| 情况 | 处理方式 |
|------|---------|
| 404 任务不存在 | 提示 taskId 不存在，让用户确认 |
| 接口连接失败 | 提示服务未启动，告知用户先启动 `npm run dev` |
| status = failed | 显示错误日志，帮助用户定位问题 |
| needsQrScan = true | 立即展示 latestQrUrl 的二维码图片 |

## 返回示例

```json
{
  "taskId": "2026-03-22T17-56-17-abc123",
  "status": "running",
  "needsQrScan": true,
  "latestQrCode": "data:image/png;base64,iVBORw0KGgo...",
  "latestQrUrl": "/api/publish/screenshot/2026-03-22T17-56-17-abc123/screenshots/qrcode-1748921234567.png",
  "checkpoints": [
    {
      "name": "login-check",
      "status": "warn",
      "message": "未检测到上传框，需要登录",
      "timestamp": "2026-03-22T17:56:18.000Z",
      "screenshotUrl": "/api/publish/screenshot/2026-03-22T17-56-17-abc123/screenshots/01-login-check.png"
    }
  ],
  "logs": ["[TASK START] 2026-03-22T17-56-17-abc123", "🔍 检测登录状态...", "⚠️ 未登录，获取二维码..."]
}
```
