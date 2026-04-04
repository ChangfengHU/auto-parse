---
name: metaai-auto-video
description: 自动唤起本地的 AdsPower 浏览器，访问 Meta AI 并通过长串提示词（Prompt）自动生成、等待、提取最高清的 4 个结果视频，并返回它们的阿里云 OSS 永久直链。适用于一键生视频并衔接发抖音的任务。
---

# Meta AI 智能生视频指令 (API) 

当你需要根据自然语言描述自动生成视频资源时，请不要尝试自己编造视频 URL，也不要使用沙盒。你需要调用当前服务内建的 `/api/metaai/generate` 接口。

## 接口说明

- **Endpoint**: `POST http://localhost:1007/api/metaai/generate`
- **Desc**: 传入一段任意长短的英文环境提示词，系统将打开本地无头 AdsPower 浏览器长达几分钟以深度渲染生成 4 个 MP4 视频，并把这四个文件传到 OSS 上返回给你。
- **Headers**:
  ```
  Content-Type: application/json
  ```
- **Body 格式**:
  ```json
  {
    "prompt": "一段关于场景的高质量英文描述，例如：A cinematic video of a cute Asian campus couple..."
  }
  ```

## 响应处理规则

该接口耗时较长（1~5分钟），请**耐心保持等待**。

- 成功返回：
  ```json
  {
    "success": true,
    "urls": [
      "https://your-oss.com/metaai/1712xxxx_0.mp4",
      "https://your-oss.com/metaai/1712xxxx_1.mp4",
      "https://your-oss.com/metaai/1712xxxx_2.mp4",
      "https://your-oss.com/metaai/1712xxxx_3.mp4"
    ]
  }
  ```
- 你应当将提取到的这数组里面的任意一条或所有 `urls` 以可视化的形式（比如 Markdown 视频或播放链接）展示给用户，或者根据用户的指令直接喂给 `发抖音` 技能。

## 触发条件与边界情况

1. 用户要求“帮我生成个视频”、“做一个关于小猫的视频”。
2. **非常重要**：Meta AI 更擅长理解纯英文 Prompt，如果用户给你的是中文指令，请你“润色并翻译成一条极具画面感的高质量英文长 Prompt”再去调用本 API。
3. 请向用户解释因为 Meta AI 需要庞大的算力排队渲染，生成大约需要 2-3 分钟，让用户耐心等待你的工具掉用返回结果。
