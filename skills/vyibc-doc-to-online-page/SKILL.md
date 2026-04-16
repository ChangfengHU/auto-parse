---
name: vyibc-doc-to-online-page
description: 将本地文档（Markdown/Text）发布为在线网页链接。采用工业级 `documents:toPage` 渲染引擎，生成精美、可公开分享的在线文档页面。
---

## 核心功能

- **一键转化为网页**：将本地 Markdown 文件或纯文本内容瞬间发布为在线 URL。
- **精美渲染**：内置工业级 Markdown 渲染逻辑，自动处理标题、列表、代码块等。
- **持久化访问**：生成的页面可长期在线访问。

## 使用方式

### 1) 发布本地文件
```bash
bash scripts/publish-page.sh --file "/abs/path/to/doc.md" --title "文档标题"
```

### 2) 直接发布文本内容
```bash
bash scripts/publish-page.sh --content "# 标题\n正文内容" --title "文档标题"
```

## 输出参数

- `[PAGE_URL]`：生成的在线网页地址。
- `[DONE]`：表示发布操作已成功完成。

## 技术规范

- **API 端点**：`https://upload.vyibc.com/v1beta/documents:toPage`
- **支持格式**：主要针对 Markdown 和纯文本优化。
