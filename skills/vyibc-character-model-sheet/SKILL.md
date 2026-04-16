---
name: vyibc-character-model-sheet
description: |
  专家级角色设定稿 (Character Model Sheet) 生成器。
  通过单张参考图自动生成标准化的正交三视图（正面、侧面、背面），为角色一致性创作提供工业级底层资产。
  内置风格感知引擎，支持写实、动漫等多种工业级预置模板。
---

## 核心功能

- **正交视图生成**：自动注入 `Orthographic`、`Turnaround` 关键词，消除透视变形。
- **一致性锁死**：强制执行 `Split view` 构图逻辑，确保各角度的面部和服装特征高度统一。
- **工业级预置**：支持 `realistic_standard` (写实人像) 和 `anime_ortho` (动漫设定) 等资源模板。

## 使用方式

当您有以下需求时会自动触发：
- "基于[URL]生成一份角色设定稿"
- "把这个人物做成三视图"
- "我想为这个角色建立视觉标准 (Model Sheet)"

## 触发规则

关键词：`角色设定`、`三视图`、`Model Sheet`、`Character Turnaround`、`标准化视图`

## 参数说明

- `sourceImageUrl`: 核心人物参考图 URL。
- `preset` (可选): 风格预置，默认为 `realistic_standard`。配合资源库中的 `.md` 文件使用。

## 资源管理

技能资源存储在 `resources/presets/` 下。生成的 HTML 监控页面将保存在当前工作目录的 `model_sheet_viewer_[TASK_ID].html` 中。
