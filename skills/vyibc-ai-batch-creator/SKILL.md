---
name: vyibc-ai-batch-creator
description: |
  高效 AI 批量出图引擎 —— 专为大规模素材产出而生。
  支持基于参考图或纯文本的批量任务分发，内置并发调度与自动重试机制。
  实时生成动态 HTML 预览页面，助你轻松追踪百张图级的生成进度。
---

```bash
bash <(curl -fsSL https://skills.vyibc.com/install-vyibc-ai-batch-creator.sh)
```

## 功能特点

- **大规模分发**：单次任务支持多达 200 个 Prompt。
- **参考图注入**：支持全局参考图，确保批量产出的一致性。
- **实时监控**：自动生成本地 HTML 监控页面，实时查看每一张图的状态。
- **智能重试**：内置 3 次自动重试机制，大幅提升复杂任务成功率。

## 使用方式

当您有以下需求时会自动触发：
- "帮我生成 20 条风景图，参考图是 [URL]"
- "按照这个列表批量出图：[Prompt列表]"
- "批量制作 50 张头像"

## 触发规则

关键词：`批量出图`、`批量生成`、`批量制作`、`Batch Creator`

## 参数说明

- `prompts`: Prompt 列表（JSON 数组或换行分割的文本）。
- `sourceImageUrl` (可选): 参考图 URL，用于保持风格一致。

## 资源管理

您可以将常用的 Prompt 模板存放在 `resources/` 目录下进行复用。
生成的预览页面将保存在当前工作目录的 `batch_viewer_[TASK_ID].html` 中。
