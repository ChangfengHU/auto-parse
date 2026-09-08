# 抖音正式视频链接兼容

## 背景

视频内容提取 MCP 会直接消费行为系统返回的
`https://www.douyin.com/video/<id>`，而小程序原解析入口只接受
`https://v.douyin.com/<code>/` 分享短链，导致两套已有能力无法串联。

## 修改

- 短链继续先解析重定向，保持原行为。
- 正式 `/video/<id>` 与 `/note/<id>` 链接直接进入同一套
  Playwright、降级解析和 R2 镜像流程。
- 不扩大到其他域名或任意 URL。

## 验证

- 本地 `eslint lib/parsers/douyin.ts` 通过；全仓 TypeScript 检查仍只有
  `lib/workflow/task-store.ts` 的既有 `WorkflowTask`/`PersistedTask` 错误。
- 生产节点 84 在真实工作树中独立实现，`npm run build` 成功，重启
  `auto-parse.service` 后状态为 active。
- 正式链接 `https://www.douyin.com/video/7675304732260306227` 返回
  `success=true`、正确 videoId/标题、`mediaType=video` 和可用视频流。
- 生产代码提交并推送为 `d7941f8`；原有 `.materials.json` 修改未纳入提交。
