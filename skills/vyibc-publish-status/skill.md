---
name: vyibc-publish-status
description: 查询抖音发布任务的进度和状态。当用户说"发布进度怎么样"、"查一下发布状态"、"任务id是xxx"、"发布成功了吗"、"看看发布日志"、"任务状态"时触发。
---

## 使用方式

调用 `scripts/status.sh` 脚本查询任务状态：

```bash
# 列出最近20条发布任务
bash scripts/status.sh

# 查询指定任务详情
bash scripts/status.sh <taskId>

# 查询 + 下载扫码二维码
bash scripts/status.sh <taskId> --qr

# 查询 + 下载所有阶段截图
bash scripts/status.sh <taskId> --screenshots
```

> 服务地址默认 `https://parse.vyibc.com`，可通过环境变量 `VYIBC_BASE_URL` 覆盖。

## 触发规则

以下情况触发本 Skill：
- 用户提到 taskId（如 `2026-03-22T17-56-17-abc`）
- 用户问"发布进度"、"发布状态"、"发布成功了吗"
- 用户说"查一下上次发布"、"看看日志"
- 发布后需要查看截图或扫码

## 执行步骤

### 查询单个任务（有 taskId）

1. 运行脚本：
   ```bash
   bash scripts/status.sh <taskId>
   ```

2. 脚本输出任务摘要、阶段进度、最近日志

3. **如果输出中出现 `[QRCODE_FILE] /tmp/...`**，立即用 Read 工具读取该文件展示给用户

4. **如果用户想看截图**，追加 `--screenshots` 参数：
   ```bash
   bash scripts/status.sh <taskId> --screenshots
   ```
   输出中会有 `[SCREENSHOT] <name>:<path>`，用 Read 工具读取各图片文件展示

### 扫码登录（needsQrScan）

当脚本提示需要扫码时，运行：
```bash
bash scripts/status.sh <taskId> --qr
```
脚本输出 `[QRCODE_FILE] /tmp/douyin-qr-xxx.png`，用 Read 工具读取文件展示二维码，提示用户：
- "Cookie 已过期，请用抖音 App 扫描上方二维码"
- "二维码约 3 分钟有效，扫码后可再次查询确认"

### 列出所有任务（无 taskId）

```bash
bash scripts/status.sh
```
列出最近20个任务，让用户选择查看哪个。

## 脚本特殊输出行

| 输出格式 | 含义 | 处理方式 |
|----------|------|----------|
| `[QRCODE_FILE] /tmp/xxx.png` | 二维码图片路径 | 用 Read 工具读取文件展示 |
| `[SCREENSHOT] <name>:<path>` | 阶段截图路径 | 用 Read 工具读取文件展示 |

## 阶段说明

| 阶段名 | 说明 |
|--------|------|
| `download` | 视频下载到本地 |
| `login-check` | 检测是否已登录抖音 |
| `login` | 扫码登录（Cookie 过期时） |
| `upload-page` | 进入视频上传页面 |
| `video-inject` | 视频文件已注入上传框 |
| `cp1-upload` | 视频上传成功 |
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
| 接口连接失败 | 提示服务未启动，确认 VYIBC_BASE_URL 是否正确 |
| status = failed | 显示错误日志，帮助用户定位问题 |
| needsQrScan = true | 运行 `--qr` 参数展示二维码 |
