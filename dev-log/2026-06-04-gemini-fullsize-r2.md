# RUNTIME-001 Gemini 原画质下载与 R2 上传回归

- 日期：2026-06-04
- 状态：In Progress
- Owner：codex
- 模块：runtime / workflow / storage
- Commit：pending

## 背景与目标
剪贴板提取只能获得较小图片，目标是通过 `extract_image_download` 获取 Gemini 原画质文件并上传 R2，最终返回可访问图片地址。

## 当前事实
- 目标正式工作流 ID：`1532bbd9-6f32-468d-b4e4-4e8c518b0949`。
- 远端工作区已有 `extract-image-download.ts`、`extract-image-clipboard.ts` 和节点目录相关未提交修改，必须保护并基于远端真实内容继续开发。
- 正式工作流配置必须读取 Supabase，不能以 `lib/rpa/workflows/*.json` 为准。

## 验证计划
- 从 Supabase 正式配置触发工作流。
- 确认执行路径使用 full-size download，不依赖剪贴板降质结果。
- 验证 R2 最终 URL、响应状态、格式、尺寸和文件大小。
- 记录失败路径、重试和是否需要重启服务。

## 下一步
完成 Supabase 单一事实源改造后，在公网工作流页面触发并进行真实回归。

## 远端真实回归结果

- 任务：`9b6e403c-da75-41f3-a902-6a839fc58dde`
- AdsPower 分身：`k1b908rw`
- 导航、输入、Gemini 生图：成功
- 全尺寸下载：收到 Download 事件，但 `download.saveAs` 返回 `canceled`
- 当前错误行为：`allowDomFallback=false` 时仍强制使用 DOM 预览图
- DOM 预览图大小：`538314 bytes`
- 正式阈值：`5000000 bytes`
- R2 上传：未执行
- 结论：远端当前不能正常返回原画质 R2 图片地址，任务保持 In Progress

## Remote success evidence
- Task: `3f9c3bf5-5b96-43cb-ac1e-ce2e9c7b4d75`
- AdsPower profile: `k1b908rw`
- Extraction: `download`, `7925481` bytes, `image/png`, `2752x1536`
- Storage: `r2`
- URL: `https://skill.vyibc.com/gemini-images/1780586925630.png` (HTTP 200)

- Git: 已创建远程提交；首次 push 因远程机器缺少有效 GitHub HTTPS/SSH 凭证被认证拒绝。
