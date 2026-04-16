# doouyin — 视频解析 & 一键发布平台

抖音/小红书/TikTok 视频去水印解析 + OSS 永久存储 + 一键发布到抖音账号。

---

## Claude Code Skills

本项目提供三个 Claude Code Skill，在 Claude Code / OpenClaw 等 AI 工具中一键完成视频解析、发布和状态查询。

### vyibc-auto-parse · 视频解析

解析抖音、小红书视频链接，自动去水印并上传到 OSS，返回永久可访问地址。

**安装：**

```bash
bash <(curl -fsSL https://skills.vyibc.com/install-vyibc-auto-parse.sh)
```

**触发：** 粘贴抖音/小红书分享链接，或说"解析视频"、"去水印"、"存OSS"

**示例：**
```
帮我解析这个抖音 https://v.douyin.com/m7Tw65kygH8/
```

---

### vyibc-auto-publish · 一键发布到抖音

将 OSS 视频通过 Playwright 无头浏览器自动发布到你的抖音账号，支持填写标题、正文、话题标签。

**安装：**

```bash
bash <(curl -fsSL https://skills.vyibc.com/install-vyibc-auto-publish.sh)
```

**触发：** 说"发布到抖音"、"上传到我的抖音"，或有 ossUrl 时明确要求发布

**示例：**
```
把这个视频发布到我的抖音，标题"治愈系短片"，正文"心怎么变都是偏向你"，话题：情感,治愈
```

**发布流程（自动完成，约 2-3 分钟）：**
1. 下载视频到本地临时文件
2. 无头浏览器打开抖音创作者中心
3. Cookie 失效时推送二维码，扫码后自动继续
4. 上传视频、填写标题/正文/话题
5. 等待内容检测通过，点击发布

---

### vyibc-publish-status · 查询发布状态

查询抖音发布任务的进度、阶段截图和扫码二维码，配合 vyibc-auto-publish 使用。

**安装：**

```bash
bash <(curl -fsSL https://skills.vyibc.com/install-vyibc-publish-status.sh)
```

**触发：** 说"发布进度怎么样"、"查一下发布状态"、"发布成功了吗"，或提供任务 ID

**示例：**
```
发布成功了吗？
查一下任务 2026-03-22T10-00-00-abc12 的进度
```

**支持功能：**
- 列出最近20条发布任务
- 查询指定任务的各阶段完成情况
- Cookie 过期时自动展示扫码二维码
- 下载各阶段截图查看发布过程。

---

### vyibc-doc-to-online-page · 文档转网页

将本地 Markdown 或纯文本一键发布为在线网页链接。采用工业级 `documents:toPage` 渲染引擎，生成精美、可公开分享的在线文档页面。

**安装：**

```bash
bash <(curl -fsSL https://skills.vyibc.com/files/install-vyibc-doc-to-online-page.sh)
```

**触发：** 说“把这段文字转成网页”、“发布我的文档”、“将文档转换为在线链接”

**示例：**
```
帮我把这个文档 /path/to/my.md 发布为在线页面，标题叫“产品指南”
```

---

### vyibc-gemini-web-image · Gemini 网页生图

通过已登录的 Gemini 网页会话执行自动化流程生成图片，返回可追踪任务 ID 与图片 URL。

**安装：**

```bash
bash <(curl -fsSL https://skills.vyibc.com/install-vyibc-gemini-web-image.sh)
```

**触发：** 说“用 Gemini 生成图片”“页面自动化生图”“按这个提示词出图”

**示例：**
```
帮我用 Gemini 生成图片：赛博朋克夜景，霓虹雨夜，电影感
```

---

### vyibc-face-consistent-album · 全感官影像艺术生成

全感官影像艺术生成器 (V4.5 Pro Max) —— **重新定义 AI 摄影的颗粒度。**
这不仅是生图，而是通过独创的『全场景通用美学逻辑』，对光影韵律、材质触感、眼神拉扯及大师构图进行多维感官控制。支持『全域魅惑』与『纯真体系』，为每一个像素注入灵魂深处的情绪张力。

**安装：**

```bash
bash <(curl -fsSL https://skills.vyibc.com/files/install-vyibc-face-consistent-album.sh)
```

**触发：** 说“用 [URL] 创作大片”“风格要魅惑/纯真”“全感官影像制作”

**示例：**
```
用这个参考图 https://example.com/ref.jpg 创作一组办公室大片，风格要 master_allure
```

---

### vyibc-ai-batch-creator · 批量 AI 出图

高效 AI 批量出图引擎，支持大规模任务分发与实时进度监控，内置自动重试机制与本地 HTML 预览页面。

**安装：**

```bash
bash <(curl -fsSL https://skills.vyibc.com/files/install-vyibc-ai-batch-creator.sh)
```

**触发：** 说“批量出图”、“批量生成”、“生成 50 张风景图”

**示例：**
```
参考这个图 https://example.com/ref.jpg 帮我批量生成 20 条赛博朋克风格的提示词并出图
```

---

### vyibc-character-model-sheet · 专家级角色设定稿

工业级角色三视图 (Turnaround) 生成器，旨在通过单张参考图为角色建立视觉标准，确保后续生图任务的高度一致性。

**安装：**

```bash
bash <(curl -fsSL https://skills.vyibc.com/files/install-vyibc-character-model-sheet.sh)
```

**触发：** 说“基于此图生成角色设定稿”、“做成三视图”、“建立视觉标准”

**示例：**
```
基于这个参考图 https://example.com/ref.jpg 生成一份动漫风格的正交三视图，风格选 anime_ortho
```

---

## API 文档

详见 [API.md](./API.md)

---

## 本地开发

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 查看。
