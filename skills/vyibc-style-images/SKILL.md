---
name: vyibc-style-images
description: |
  风格参考图批量生图工具。使用一张参考图保持人物/主体一致，把用户给出的场景 prompt 与内置风格 preset
  或任意自然语言风格描述合并，然后调用 auto-parse 的 Gemini Ads dispatcher 批量生成图片。
  当用户说“style-images”、“风格图”、“参考图生成一组图”、“用这张图按某某风格出图”等需求时使用。
---

## 核心能力

- 参考图一致性：把同一张 `sourceImageUrl` 注入所有 runs。
- 风格注入：优先加载 `resources/styles/{style}.md`，找不到时把用户给出的风格词作为自由风格描述注入 prompt。
- 自动调度：调用 `/api/gemini-web/image/ads-dispatcher`，默认使用当前服务端 `ADS_INSTANCE_POOL_IDS`。
- 监控页面：提交成功后生成 `viewer_{TASK_ID}.html`。

## 使用方式

当用户表达以下意图时使用：
- "用 [URL] 做参考图，生成一组 [风格] 图片"
- "style-images，用这张图出宫崎骏风格"
- "参考图生成 fuji 风格写真"
- "把这个人物做成一组不同风格图"

### 第一步：你（agent）先生成 prompts

**提示词由 agent 自己生成，不由脚本生成。** 每条 prompt 遵循以下四层结构：

```
① 人物一致性锚定（固定开头，每张都要有）
"以参考图中的同一位[女生/人物]为唯一人物主体，保持五官、发型、脸型、肤色、
 年龄感、身材比例一致，不要改变人物身份。"

② 场景描述（每张不同，你来生成 N 个变体）
描述：地点 + 光线 + 姿态/动作 + 表情 + 服装/道具 + 画面构图
要点：场景之间要有差异（室内/室外、近景/全身、动态/静态），
     但整体风格与用户要求的 style 保持一致。

③ 氛围/质量词（参考对应 style preset 的风格精髓，用 1-2 句）
从 resources/styles/{style}.md 的 "风格精髓" 段提炼

④ 安全输出指令（固定结尾，每张都要有）
"只输出一张静态图片，不要拼图，不要多人物，不要文字水印。"
```

生成完成后，写入 `/tmp/style_prompts.json`（数组，每项含 `prompt` 字段，可选 `style` 字段）：

```json
[
  {
    "prompt": "以参考图中的同一位女生为唯一人物主体，保持五官、发型、脸型、肤色、年龄感、身材比例一致，不要改变人物身份。场景在海边日落时分，女生站在沙滩上微微侧身看向镜头，长发被海风轻轻吹起，脸上是自然放松的甜美微笑，一只手轻轻整理头发，背景是柔和海浪和金色夕阳，整体像高级感朋友圈打卡照片，真实摄影感，清透肤色，干净构图，生活方式大片。只输出一张静态图片，不要拼图，不要多人物，不要卡通。",
    "style": null
  }
]
```

> `"style": null` 表示 prompt 已完整，跳过风格注入。有风格词时填写对应 key，脚本会追加风格精髓一句。

### 第二步：调用脚本派发

```bash
python3 skills/vyibc-style-images/scripts/call_dispatcher.py /tmp/style_prompts.json "https://example.com/reference.png"
```

脚本会自动轮询，完成后：
1. 以 `[图片N](url)` 格式输出每张图片链接（图片托管在 `https://skill.vyibc.com/douyin/` 即 R2 CDN）
2. 自动生成**照片墙预览页**并上传到 R2，输出公网地址：
   ```
   🖼️  照片墙预览：https://skill.vyibc.com/viewer/viewer_{TASK_ID}.html
   ```
   直接在浏览器打开即可，支持点击图片灯箱放大，无需本地文件。

## 内置风格

- `master_allure`：全域魅惑，高级吸引力，强眼神和时装摄影感。
- `pure_ethereal`：纯真清透，氧气感，高调柔光。
- `fuji`：富士胶片，生活方式抓拍，真实朋友圈摄影感。
- `classic_diva`：明艳女神，红毯气质，经典高定感。
- `urban_spice`：都市街拍，高冲击力，街头时装感。
- `vibrant_goddess`：阳光女神，明亮健康，黄金光线。
- `yandere_style`：暗调情绪，神秘冷感，强眼神叙事。
- `global_temptation`：全域诱惑，全身广告大片，奢华服饰，黄金+冷蓝分体光，强眼神吸引力。

未知风格不会失败。例如 `宫崎骏风格`、`赛博朋克`、`新海诚感` 会作为自由风格描述直接注入 prompt。

## 注意事项

- **不要在 prompt 前后加任何通用英文套话**。以下内容会与"参考图人物一致性锚定"竞争，导致 Gemini 生成陌生人物，必须禁止出现：
  - 前缀：`Create exactly one finished still image now`、`Do not answer with text`、`The output must be an image`
  - 后缀：`Use an adult, fully clothed`、`Keep it tasteful`、`Single still image only`、`Image output only`
  - （脚本内置了自动清理，但 agent 本身也不应生成这些内容）

- **不要把图片 URL 作为裸 URL 输出给 agent**。脚本内置了 `poll_results()` 轮询，结果以 `[图片N](url)` markdown 链接格式输出，不会触发 agent 的 image_url 自动识别逻辑（DeepSeek / 纯文本模型会因此报 `unknown variant image_url` 错误）。
- agent 汇报结果时应直接复述链接文本，**不得将 URL 转为内嵌图片 block**。

## 环境

- 默认 API：`https://parse.vyibc.com`（cloudflared 稳定隧道，公网可用，无需本地部署）
- 可用 `STYLE_IMAGES_API_BASE` 覆盖 API 地址。
- 可用 `STYLE_IMAGES_WORKFLOW_ID` 覆盖工作流；默认 `4a163587-6e5e-4176-8178-0915f0429ee0`。
- 默认不传 `instanceIds`，由 dispatcher 读取服务端默认实例池。

## 发布信息

- Status: published
- Published at: 2026-06-12T18:18:04Z
- Install command: `bash <(curl -fsSL https://skill.vyibc.com/install-vyibc-style-images.sh)`
- Install script: `https://skill.vyibc.com/install-vyibc-style-images.sh`
- Zip package: `https://skill.vyibc.com/vyibc-style-images-20260612181804.zip`
- Local backup: `/home/a01020323900/.codex/skills/.system/published/install-vyibc-style-images.sh`
