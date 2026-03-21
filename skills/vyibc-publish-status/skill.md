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
- 用户提到 taskId（如 "1748921234567-abc"）
- 用户问"发布进度"、"发布状态"、"发布成功了吗"
- 用户说"查一下上次发布"、"看看日志"
- 发布脚本已在运行，用户想查看进度截图

## 执行步骤

### 查询单个任务（有 taskId）

1. 调用状态接口：
   ```bash
   curl -s "http://localhost:1007/api/publish/status?taskId=<taskId>"
   ```

2. 解析返回的 JSON，包含：
   - `taskId`：任务ID
   - `status`：`running` / `done` / `error`
   - `videoUrl`：发布的视频地址
   - `stages[]`：各检查点信息，每个 stage 有：
     - `name`：阶段名称（如 "login-check", "upload-page", "cp1-upload", "cp2-title", "cp3-cover", "cp4-detect", "publish-success"）
     - `status`：`pending` / `running` / `done` / `error`
     - `ts`：时间戳（毫秒）
     - `screenshotUrl`：截图URL（可选）
   - `latestQr`：最新二维码 base64（`data:image/png;base64,...`），仅未登录时有值
   - `logs[]`：日志行数组

3. 展示任务摘要：
   - 任务状态（运行中/已完成/失败）
   - 各阶段完成情况（用 ✅ / 🔄 / ❌ / ⏳ 表示）
   - 总耗时

4. **展示截图**：遍历 stages，对有 `screenshotUrl` 的阶段：
   ```bash
   # 下载截图到临时文件
   curl -s "http://localhost:1007<screenshotUrl>" -o /tmp/stage-<name>.png
   ```
   然后用 Read 工具读取并展示图片（Claude Code 支持直接内嵌图片）

5. **展示二维码**（如果 `latestQr` 有值）：
   - 将 base64 解码为图片：
     ```bash
     echo "<base64内容>" | base64 -d > /tmp/douyin-qr-status.png
     ```
   - 用 Read 工具读取展示，提示用户扫码

### 查询任务列表（无 taskId）

1. 调用：
   ```bash
   curl -s "http://localhost:1007/api/publish/status"
   ```

2. 返回最近20个任务数组，每项包含：
   - `taskId`、`status`、`videoUrl`、`startedAt`、`completedAt`

3. 以表格或列表形式展示，让用户选择要查看的任务

## 阶段说明

| 阶段名 | 说明 |
|--------|------|
| `login-check` | 检测是否已登录抖音 |
| `upload-page` | 进入视频上传页面 |
| `cp1-upload` | 视频上传中（含进度百分比） |
| `cp2-title` | 填写标题和描述 |
| `cp3-cover` | 封面自动生成 |
| `cp4-detect` | 内容安全检测 |
| `publish-success` | 发布成功 |

## 状态图标

- ✅ done：该阶段已完成
- 🔄 running：正在进行
- ❌ error：失败
- ⏳ pending：等待中

## 错误处理

| 情况 | 处理方式 |
|------|---------|
| 接口返回 404 | 提示 taskId 不存在，让用户确认 |
| 接口连接失败 | 提示服务未启动，告知用户先启动 `npm run dev` |
| status = error | 显示错误日志，帮助用户定位问题 |
| latestQr 有值 | 展示二维码提示扫码登录 |

## 返回示例

```json
{
  "taskId": "1748921234567-abc123",
  "status": "done",
  "videoUrl": "https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/xxx.mp4",
  "startedAt": 1748921234567,
  "completedAt": 1748921368000,
  "stages": [
    { "name": "login-check", "status": "done", "ts": 1748921234800, "screenshotUrl": "/api/publish/screenshot/1748921234567-abc123/01-login-check.png" },
    { "name": "upload-page", "status": "done", "ts": 1748921235200, "screenshotUrl": "/api/publish/screenshot/1748921234567-abc123/02-upload-page.png" },
    { "name": "cp1-upload",  "status": "done", "ts": 1748921368000, "screenshotUrl": "/api/publish/screenshot/1748921234567-abc123/03-cp1-upload.png" },
    { "name": "cp2-title",   "status": "done", "ts": 1748921370000 },
    { "name": "cp3-cover",   "status": "done", "ts": 1748921372000 },
    { "name": "cp4-detect",  "status": "done", "ts": 1748921374000, "screenshotUrl": "/api/publish/screenshot/1748921234567-abc123/04-cp4-detect.png" },
    { "name": "publish-success", "status": "done", "ts": 1748921376000 }
  ],
  "latestQr": null,
  "logs": ["[TASK] 1748921234567-abc123", "🔍 检测登录状态...", "✅ 已登录，直接进入上传页", "..."]
}
```
