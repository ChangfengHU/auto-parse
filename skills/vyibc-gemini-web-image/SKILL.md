---
name: vyibc-gemini-web-image
description: 通过 Gemini 网页自动化工作流生成图片，返回任务进度与图片URL。适用于“生成图片”“Gemini 网页生图”“用已登录浏览器生成图”等场景。
---

## 使用方式

调用 `scripts/generate.sh`：

```bash
bash scripts/generate.sh "<prompt>" "<workflowId可选>" "<keepTabOpen:true|false可选>"
```

- `prompt`：必填，图片描述（中英文均可）
- `workflowId`：可选，默认使用服务端配置的 Gemini 生图工作流
- `keepTabOpen`：可选，默认 `false`（任务结束自动关闭 tab）；传 `true` 可保留页面

## 触发规则

- 用户说“用 Gemini 生成图片”“帮我出图”“页面自动化生图”
- 用户要求使用当前已登录浏览器会话出图
- 需要返回可追踪 taskId 的异步生图任务

## 输出解析规则

脚本会输出以下关键行：

- `[TASK_ID] <id>`：任务 ID，必须保存用于后续查进度
- `[PROGRESS] <name>:<status>:<message>`：步骤进度
- `[IMAGE_URL] <url>`：生成图片地址（可能多条）
- `[DONE] ...`：任务成功结束
- `[ERROR] ...`：任务失败

## 服务地址

默认使用 `https://parse.vyibc.com`，可通过 `VYIBC_BASE_URL` 覆盖。
