# 快速启动（Debug 发布）

## 启动

```bash
npm run dev
```

服务地址：`http://localhost:1007`

## 核心页面

- 发布页：`http://localhost:1007/publish`
- Debug 工作流页：`http://localhost:1007/workflows`

## 使用方式

1. 在 `/publish` 填好 `视频地址 + 标题`
2. 点击 `Debug 发布（逐步执行）`
3. 进入 `/workflows` 后：
   - 可点击任意步骤执行
   - 或点击 `执行下一步` 按顺序推进
   - 在右侧查看实时日志

## 调试 API

### 健康检查

```bash
curl -s http://localhost:1007/api/workflow/browser
```

### 执行“打开发布页”步骤

```bash
curl -s -X POST http://localhost:1007/api/workflow/browser \
  -H "Content-Type: application/json" \
  -d '{
    "action":"execute-step",
    "payload":{
      "id":"start",
      "type":"navigate",
      "params":{"url":"https://creator.douyin.com/creator-micro/content/upload"},
      "context":{"videoUrl":"https://example.com/a.mp4","title":"测试标题"}
    }
  }'
```

## 说明

- 自动发布（原流程）仍在 `/publish`，不受影响
- Debug 发布用于手动推进步骤，便于稳定性排障

