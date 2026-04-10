---
name: vyibc-gemini-ads-ha
description: Gemini Ads 高可用图片生成。支持 10+ 提示词自动调度、失败重试、任务查询与取消。
---

## 接口

- 创建：`POST /api/gemini-web/image/ads-ha`
- 查询：`GET /api/gemini-web/image/ads-ha/tasks/{taskId}`
- 取消：`POST /api/gemini-web/image/ads-ha/tasks/{taskId}/cancel`

## 脚本

```bash
# 创建（默认 10 条提示词 + 3 个实例）
bash scripts/create-ha.sh

# 查询
bash scripts/query-ha.sh --task-id <taskId>

# 取消
bash scripts/cancel-ha.sh --task-id <taskId>
```

