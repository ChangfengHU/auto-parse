---
name: vyibc-doc-to-online-page
description: 将本地文档（md/txt/html）发布为 OSS 在线网页链接。适用于“把文档变成在线地址”“上传本地文档并可分享”等场景。
---

## 使用方式

### 1) 用本地文件发布
```bash
bash scripts/publish-page.sh --file "/abs/path/to/doc.md" --title "文档标题"
```

### 2) 用文本内容发布
```bash
bash scripts/publish-page.sh --content "# 标题\n正文内容" --title "文档标题"
```

## 输出

- `[PAGE_URL] <url>` 在线网页地址
- `[OSS_KEY] <key>` OSS 对象路径
- `[DONE] 发布成功`
- `[ERROR] xxx`

## 对应接口

- `POST /api/docs/publish-page`
  - `title?: string`
  - `content?: string`
  - `filePath?: string`
  - `folder?: string`（默认 `doc-pages`）
  - `objectKey?: string`（传固定 key 可覆盖同一 URL 的内容）
  - `provider?: "doc-to-page" | "oss"`（默认 `doc-to-page`，优先返回可直接在线访问页面）
