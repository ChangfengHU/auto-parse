---
name: vyibc-gemini-ads-batch
description: 基于 AdsPower 多实例并行执行 Gemini 生图工作流，返回 taskId、每组状态和图片 URL。适用于“两个实例并行生图”“批量提示词出图”“按实例池跑生图任务”等场景。
---

## 使用方式

创建批量任务：

```bash
bash scripts/create-batch.sh '<runs-json>' '<workflowId可选>' '<maxConcurrency可选>'
```

查询任务状态：

```bash
bash scripts/query-batch.sh '<taskId>'
```

取消任务：

```bash
bash scripts/cancel-batch.sh '<taskId>'
```

## runs JSON 格式

`runs` 必须是数组，每项包含：
- `browserInstanceId`（必填）
- `prompt`（必填）
- `browserWsUrl`（可选）

示例：

```json
[
  { "browserInstanceId": "k1b908rw", "prompt": "赛博朋克城市夜景，电影感，8k" },
  { "browserInstanceId": "k1bc2kj2", "prompt": "北欧极简客厅，清晨光线，真实摄影" }
]
```

## 输出解析规则

- `[TASK_ID] <id>`：批量任务 ID（必须保存）
- `[STATUS] <status>`：任务状态（queued/running/success/failed/cancelled）
- `[SUMMARY] total=X success=Y failed=Z running=...`：汇总状态
- `[RUN] #<index> <instanceId> <status> <prompt>`：分组状态
- `[IMAGE_URL] <url>`：图片地址（可能多条）
- `[DONE] ...`：任务结束且有结果
- `[ERROR] ...`：任务失败或无可用结果

## 已有接口

- `POST /api/gemini-web/image/ads-batch` 创建任务
- `GET /api/gemini-web/image/ads-batch/tasks/:taskId` 查询状态与结果
- `POST /api/gemini-web/image/ads-batch/tasks/:taskId/cancel` 取消任务
