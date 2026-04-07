# 视频解析 & 发布 API 文档

> 服务地址：**https://parse.vyibc.com**

---

## 接口列表

| 接口 | 说明 | 耗时 |
|------|------|------|
| `POST /api/parse` + `watermark:false` | 抖音无水印解析 + OSS上传 | ~25s |
| `POST /api/parse` + `watermark:true`  | 抖音有水印解析 + OSS上传 | ~3s  |
| `POST /api/parse` (小红书链接)         | 小红书视频解析 + OSS上传 | ~5s  |
| `POST /api/parse` (TikTok链接)        | TikTok无水印解析 + OSS上传 | ~15s |
| `POST /api/publish` (SSE)             | 一键发布视频到抖音账号 | ~2-3min |
| `POST /api/gemini-web/image/generate` | 创建 Gemini 网页生图任务 | <1s |
| `GET /api/gemini-web/image/tasks/:id` | 查询 Gemini 生图任务状态 | <1s |
| `POST /api/gemini-web/image/tasks/:id/cancel` | 取消 Gemini 生图任务 | <1s |

---

## POST /api/parse

统一解析接口，自动识别平台。

### 请求

**Headers**

```
Content-Type: application/json
```

**Body**

```json
{
  "url": "分享链接或包含链接的文本",
  "watermark": false
}
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | string | ✅ | — | 分享链接，支持带前后文字的完整分享文本 |
| `watermark` | boolean | ❌ | `false` | 仅对抖音生效。`false`=无水印(慢)，`true`=有水印(快) |

### 响应

**成功 200**

```json
{
  "success": true,
  "platform": "douyin",
  "videoId": "7590273602331816806",
  "title": "2026已到站💃#新年有礼了 #2026启动仪式",
  "videoUrl": "https://v5-dy-o-abtest.zjcdn.com/xxx/video/tos/...",
  "ossUrl": "https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/7590273602331816806.mp4",
  "watermark": false
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 是否成功 |
| `platform` | string | 平台：`douyin` / `xiaohongshu` / `tiktok` |
| `videoId` | string | 平台内的视频唯一 ID |
| `title` | string | 视频完整文案（含话题标签）。注：抖音/TikTok 无独立 title 字段，`desc` 即全部内容 |
| `videoUrl` | string | 原始 CDN 地址（有效期短，建议用 ossUrl） |
| `ossUrl` | string | OSS 永久地址（公开可访问） |
| `watermark` | boolean | `false`=无水印，`true`=有水印 |

**失败 400 / 500**

```json
{
  "error": "错误描述"
}
```

---

## POST /api/publish（SSE 流式）

将 OSS 视频一键发布到你的抖音账号。使用 Playwright 无头浏览器自动完成全流程。

> ⚠️ 该接口为 **Server-Sent Events** 流式响应，需用流式读取方式调用。

### 请求

```
Content-Type: application/json
```

```json
{
  "videoUrl": "https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/xxx.mp4",
  "title": "视频标题（最多30字）",
  "description": "正文内容，可以很长，支持换行和表情符号",
  "tags": ["话题1", "话题2"]
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `videoUrl` | string | ✅ | OSS 视频地址或任意公开 MP4 直链 |
| `title` | string | ✅ | 发布标题，超过30字自动截断 |
| `description` | string | ❌ | 正文内容，填入描述编辑器，支持换行和表情 |
| `tags` | string[] | ❌ | 话题标签（不含#），最多3个，追加在正文末尾 |

### 响应（SSE 事件流）

每个事件为 `data: {...}\n\n` 格式：

```
data: {"type":"log","payload":"⏳ 开始下载视频到本地..."}
data: {"type":"log","payload":"✅ 视频下载完成"}
data: {"type":"log","payload":"🚀 启动浏览器（无头模式）..."}
data: {"type":"log","payload":"⚠️ 检测到未登录，正在获取扫码登录二维码..."}
data: {"type":"qrcode","payload":"data:image/png;base64,..."}
data: {"type":"log","payload":"📱 请用抖音 App 扫描上方二维码（约 3 分钟有效）"}
data: {"type":"log","payload":"✅ 扫码登录成功！保存 Cookie..."}
data: {"type":"log","payload":"📤 开始上传视频..."}
data: {"type":"log","payload":"✅ Checkpoint 1：视频上传成功"}
data: {"type":"log","payload":"✅ Checkpoint 2：标题已填写 → \"xxx\""}
data: {"type":"log","payload":"✅ Checkpoint 3：封面已自动生成"}
data: {"type":"log","payload":"检测中 [████████░░░░░░░░░░░░] 40%  (9s)"}
data: {"type":"log","payload":"检测通过 ✅"}
data: {"type":"log","payload":"🎉 发布成功！视频已提交抖音审核"}
data: {"type":"done","payload":"发布成功！视频已提交抖音审核"}
```

| 事件 type | 说明 |
|-----------|------|
| `log` | 进度日志，实时展示给用户 |
| `qrcode` | base64 图片，Cookie 过期时显示扫码登录 |
| `done` | 发布成功，流结束 |
| `error` | 发布失败，payload 为错误信息 |

### 登录机制

- **有效 Cookie**：全自动静默完成，无需干预
- **Cookie 过期**：推送 `qrcode` 事件，用户扫码后自动继续，新 Cookie 自动保存
- **并发保护**：文件锁防止同时运行多个发布任务（PID 检测，热重载安全）

### JavaScript 调用示例

```javascript
const res = await fetch('https://parse.vyibc.com/api/publish', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    videoUrl: 'https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/xxx.mp4',
    title: '视频标题',
    tags: ['测试', 'AI']
  })
});

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const { type, payload } = JSON.parse(line.slice(6));
    if (type === 'log') console.log(payload);
    if (type === 'qrcode') showQRCode(payload); // 展示二维码图片
    if (type === 'done') console.log('✅ 发布成功');
    if (type === 'error') console.error('❌', payload);
  }
}
```

---

## 使用示例

### 抖音 · 无水印（推荐）

```bash
curl -X POST https://parse.vyibc.com/api/parse \
  -H "Content-Type: application/json" \
  -d '{
    "url": "9.43 B@T.yt 05/19 VYm:/ 心怎么变 都是偏向你 https://v.douyin.com/m7Tw65kygH8/",
    "watermark": false
  }'
```

### 抖音 · 有水印（快速）

```bash
curl -X POST https://parse.vyibc.com/api/parse \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://v.douyin.com/m7Tw65kygH8/",
    "watermark": true
  }'
```

### 小红书

```bash
curl -X POST https://parse.vyibc.com/api/parse \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.xiaohongshu.com/explore/6993fd3e000000002800bc9c?xsec_token=xxx"
  }'
```

### JavaScript / Fetch

```javascript
const res = await fetch('https://parse.vyibc.com/api/parse', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://v.douyin.com/m7Tw65kygH8/',
    watermark: false   // true = 有水印快速模式
  })
});
const data = await res.json();
// data.ossUrl  → 永久 OSS 地址
// data.videoUrl → 原始 CDN 地址
```

### Python

```python
import requests

resp = requests.post(
    'https://parse.vyibc.com/api/parse',
    json={
        'url': 'https://v.douyin.com/m7Tw65kygH8/',
        'watermark': False
    }
)
data = resp.json()
print(data['ossUrl'])   # OSS 永久地址
```

---

## 错误码说明

| HTTP 状态 | error 内容 | 原因 |
|-----------|-----------|------|
| 400 | 请提供分享链接 | url 为空 |
| 400 | 暂不支持该平台 | 不是抖音/小红书链接 |
| 400 | 未找到有效的抖音分享链接 | 链接格式不对 |
| 500 | 短链解析失败 | 抖音短链失效 |
| 500 | Playwright 超时 | 网络慢或 Cookie 过期 |
| 500 | 页面中未找到视频地址 | 视频已删除或需登录 |

---

## 注意事项

1. **抖音无水印模式**需要服务端配置有效的登录 Cookie，Cookie 过期后自动降级为有水印模式
2. **OSS 地址**为永久公开地址，推荐优先使用
3. **小红书**固定无水印，无需 Cookie
4. 接口无鉴权，建议部署时自行加上 IP 白名单或 Token

---

## Gemini 网页生图 API（Workflow 驱动）

使用已登录的持久化浏览器会话执行 `gemini流程管理`（或你指定的 workflowId）生成图片。接口为异步任务模型，适合 Agent 调用。

### 1) POST /api/gemini-web/image/generate

创建生图任务并立即返回 taskId。

**Body**

```json
{
  "prompt": "赛博朋克夜景，霓虹雨夜，电影感",
  "workflowId": "79d9e71f-1afe-4040-a93d-f360fc55978a",
  "promptVarName": "prompt",
  "keepTabOpen": false,
  "vars": {
    "style": "cinematic"
  }
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | ✅ | 生图提示词 |
| `workflowId` | string | ❌ | 指定工作流 ID；不传则使用服务端默认 Gemini 生图流程 |
| `promptVarName` | string | ❌ | 将 prompt 注入到哪个工作流变量，默认自动推断 |
| `keepTabOpen` | boolean | ❌ | 默认 `false`，任务完成后自动关闭本次新建 tab。设为 `true` 可保留 |
| `vars` | object | ❌ | 额外变量，会与 `prompt` 合并后传给 workflow |

**成功 200**

```json
{
  "taskId": "5ad8f4ec-7ab7-4fa0-8fd9-5ecfcc51f90b",
  "status": "queued",
  "workflow": {
    "id": "79d9e71f-1afe-4040-a93d-f360fc55978a",
    "name": "gemini流程管理"
  },
  "sessionId": "0c5b4ab5-ea91-4c7e-a4ef-7f3f69c4fd2e",
  "message": "任务已创建，使用 /api/gemini-web/image/tasks/:id 查询进度"
}
```

### 2) GET /api/gemini-web/image/tasks/:id

查询任务详情、步骤 checkpoint、最终图片地址。

**成功 200（示例）**

```json
{
  "id": "5ad8f4ec-7ab7-4fa0-8fd9-5ecfcc51f90b",
  "status": "success",
  "checkpoints": [
    {
      "stepIndex": 0,
      "name": "打开 Gemini",
      "status": "ok",
      "message": "步骤完成",
      "timestamp": "2026-04-07T09:30:11.000Z"
    }
  ],
  "result": {
    "imageUrls": [
      "https://articel.oss-cn-hangzhou.aliyuncs.com/gemini/2026xxx.png"
    ],
    "primaryImageUrl": "https://articel.oss-cn-hangzhou.aliyuncs.com/gemini/2026xxx.png",
    "outputs": {},
    "vars": {
      "prompt": "赛博朋克夜景，霓虹雨夜，电影感"
    },
    "sessionId": "0c5b4ab5-ea91-4c7e-a4ef-7f3f69c4fd2e"
  }
}
```

`status` 枚举：`queued` / `running` / `success` / `failed` / `cancelled`

### 3) POST /api/gemini-web/image/tasks/:id/cancel

请求取消任务（任务可能在当前步骤结束后停止）。

**成功 200**

```json
{
  "taskId": "5ad8f4ec-7ab7-4fa0-8fd9-5ecfcc51f90b",
  "status": "running",
  "cancelRequested": true
}
```
