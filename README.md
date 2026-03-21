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

## API 文档

详见 [API.md](./API.md)

---

## 本地开发

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 查看。
