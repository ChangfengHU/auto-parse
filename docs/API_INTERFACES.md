# 工作流接口文档（Gemini / Ads / 解析 / 发布）

## 1) Gemini 单图生成（异步任务）

### 创建任务
- `POST /api/gemini-web/image/generate`

示例入参：
```json
{
  "prompt": "赛博朋克城市夜景，霓虹灯，电影感，8k",
  "mode": "ads",
  "browserInstanceId": "k1b908rw",
  "autoCloseTab": false
}
```

示例返回：
```json
{
  "success": true,
  "taskId": "18aa81f4-23e4-4dcd-b73c-f4b6b3d8be90",
  "status": "queued"
}
```

### 查询任务
- `GET /api/gemini-web/image/tasks/{taskId}`

示例返回：
```json
{
  "success": true,
  "done": false,
  "resultReady": false,
  "status": "running",
  "result": {
    "imageUrls": [],
    "primaryImageUrl": null
  }
}
```

### 取消任务
- `POST /api/gemini-web/image/tasks/{taskId}/cancel`

---

## 2) Gemini Ads 批量生成（异步批任务）

### 创建批任务
- `POST /api/gemini-web/image/ads-batch`

示例入参（生成两张）：
```json
{
  "runs": [
    {
      "browserInstanceId": "k1b908rw",
      "prompt": "赛博朋克城市夜景，霓虹灯，电影感，8k",
      "autoCloseTab": false
    },
    {
      "browserInstanceId": "k1bc2kj2",
      "prompt": "北欧极简客厅，清晨自然光，写实摄影，高级质感",
      "autoCloseTab": false
    }
  ]
}
```

示例返回：
```json
{
  "success": true,
  "taskId": "d4a0a03c-af35-4e76-9509-ea75f873071b",
  "status": "running"
}
```

### 查询批任务
- `GET /api/gemini-web/image/ads-batch/tasks/{taskId}`

示例返回：
```json
{
  "success": true,
  "done": false,
  "resultReady": false,
  "status": "running",
  "result": {
    "imageUrls": [],
    "successCount": 0,
    "failedCount": 0,
    "cancelledCount": 0,
    "totalCount": 2,
    "runs": [
      {
        "index": 0,
        "browserInstanceId": "k1b908rw",
        "prompt": "赛博朋克城市夜景，霓虹灯，电影感，8k",
        "status": "running",
        "imageUrls": [],
        "primaryImageUrl": null,
        "taskId": "18aa81f4-23e4-4dcd-b73c-f4b6b3d8be90",
        "startedAt": "2026-04-09T12:59:55.428Z"
      }
    ]
  }
}
```

### 取消批任务
- `POST /api/gemini-web/image/ads-batch/tasks/{taskId}/cancel`

---

## 2.1) Gemini Ads 高可用批量生成（新接口，失败自动重试）

### 创建任务
- `POST /api/gemini-web/image/ads-ha`

示例入参（默认支持 10+ 提示词）：
```json
{
  "prompts": [
    "赛博朋克城市夜景，霓虹灯，电影感，8k",
    "情侣校园散步，电影感，8k",
    "北欧极简客厅，清晨自然光，写实摄影，高级质感"
  ],
  "instanceIds": ["k1b908rw", "k1bc2kj2", "k1bc2kja"],
  "maxConcurrency": 3,
  "maxAttemptsPerPrompt": 6,
  "runTimeoutMs": 480000,
  "pollIntervalMs": 2000
}
```

### 查询任务
- `GET /api/gemini-web/image/ads-ha/tasks/{taskId}`

返回包含：
- `result.imageUrls`：已成功产出的全部图片 URL
- `result.items[]`：逐提示词状态、重试次数、对应实例、URL、错误信息

### 取消任务
- `POST /api/gemini-web/image/ads-ha/tasks/{taskId}/cancel`

---

## 3) 抖音/小红书视频解析

### 通用解析
- `POST /api/parse`

示例入参：
```json
{
  "url": "https://v.douyin.com/xxxx/"
}
```

### 抖音专用解析
- `POST /api/parse-tiktok`

示例入参：
```json
{
  "url": "https://v.douyin.com/xxxx/"
}
```

---

## 4) 发布接口

### 提交发布任务
- `POST /api/publish`

示例入参：
```json
{
  "platform": "douyin",
  "videoUrl": "https://oss.example.com/a.mp4",
  "title": "标题",
  "content": "描述"
}
```

### 查询发布状态
- `GET /api/publish/status?taskId={taskId}`

---

## 5) 工作流会话步骤接口（执行引擎）

### 推进步骤
- `POST /api/workflow/session/{sessionId}/step`

用途：
- 执行当前节点
- 返回节点日志、变量、下一步状态
- 前端可轮询该接口驱动整个流程执行
