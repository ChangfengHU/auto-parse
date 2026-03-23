# Debug 发布工作流（逐步执行）

## 概述

工作流页面现在聚焦 **Debug 发布**：把抖音发布流程拆成可手动执行的步骤。  
核心目标是稳定性排查：哪里失败就停在哪一步，手动推进，不再“黑盒一把梭”。

## 入口

- 发布页：`/publish`
- 点击按钮：`Debug 发布（逐步执行）`
- 跳转页面：`/workflows`

跳转时会自动携带当前表单参数：
- `ossUrl`
- `title`
- `description`
- `tags`
- `clientId`

## 页面结构

- 左侧：抖音发布步骤清单（每步可单独执行）
- 右侧：
  - Debug 参数面板（可修改视频地址、标题、描述等）
  - 执行日志面板
  - 顶部快捷操作：`执行下一步`、`重置进度`

## 支持的步骤类型

通过 `POST /api/workflow/browser` 执行：

- `navigate`：打开页面
- `condition`：检测登录状态
- `upload`：下载 OSS 视频并注入上传输入框
- `wait`：等待指定毫秒
- `type`：填写标题/描述
- `click`：点击按钮
- `emit`：提示类步骤（不操作浏览器）

## API

### 健康检查

```http
GET /api/workflow/browser
```

返回：

```json
{
  "ok": true,
  "mode": "debug-step",
  "message": "Debug 发布步骤执行 API 已就绪"
}
```

### 执行单步

```http
POST /api/workflow/browser
Content-Type: application/json
```

```json
{
  "action": "execute-step",
  "payload": {
    "id": "start",
    "type": "navigate",
    "params": {
      "url": "https://creator.douyin.com/creator-micro/content/upload"
    },
    "context": {
      "videoUrl": "https://xxx/video.mp4",
      "title": "测试标题",
      "description": "测试描述"
    }
  }
}
```

## 与原发布流程关系

- `/publish` 的自动发布流程保留不变
- `/workflows` 是独立的 Debug 模式
- 两者都复用持久化浏览器实例（指纹和登录态一致）

## 适用场景

- 定位“自动发布失败”的具体步骤
- 手动验证新选择器是否可用
- 抖音页面变更后的快速回归排查

