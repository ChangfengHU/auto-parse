# 小红书与抖音图文工作流

新增两个独立流程，复用现有 auto-parse 工作流 MCP，不需要安装另一个 MCP：

| 平台 | 正式工作流 ID | 84 浏览器 |
| --- | --- | --- |
| 小红书 | `1dc07adf-65a1-48f0-98ab-31cfcafc7fd3` | 1 |
| 抖音 | `53197d8e-a89d-4d1a-bb8d-fc114156f30f` | 2 |

入口：`/workflows/{id}`。抖音由正式 copy 接口复制原件后适配；已有抖音原件、批准的视频副本与小红书视频流程均不修改。配置唯一事实源为 Supabase，本文不是运行时配置文件。

## 流程及输入

六个节点：打开创作者首页 → 进入图文编辑 → 有序多图上传 → 填写并核对文案/AI声明 → 条件发布 → 截图。

- `imageUrls`：有序 JSON 数组字符串，或每行一个 HTTPS 地址；仅 resource.vyibc.com / cdn.vyibc.com 的 PNG/JPEG/WebP 文件，不接受签名查询参数、重定向或其他域名。
- `title`：非空，最多 20 个字符；`description`：最多 900 字符，可空。
- `aiGenerated`：必须明确为字符串 `"true"` 或 `"false"`。
- `requestId`：8–100 位字母/数字/下划线/短横线。同一发布意图保持不变。
- `directPublish`：默认 false。false 会完整上传、填写、核对，然后停在任务编辑页；**不代表云端草稿已保存**。true 才执行最后的发布节点。
- 目标账号稳定 ID 写在流程节点参数中：小红书使用 userId，不使用可能变更的小红书号；抖音使用 UID。改账号需先核对登录身份，再显式改副本参数。

当前实现上限 1–9 张、单张 10 MiB、合计 50 MiB。这是实现边界，不是平台最大限额。默认使用平台首图/默认封面，不提供独立封面、背景音乐、定时、私密或跨平台同时发布选项；原生话题实体尚未支持，正文中的话题仅按普通文本填写。发布前校验公开、立即发布、单平台设置，发现不一致即停止。

## 页面和 MCP 调用

页面使用“已登录浏览器 · 一键完整执行”，选择表中浏览器，填写参数；直接发布开关默认关闭。旧的未认证调试/任务接口不能执行新图文节点。

已有工作流 MCP 安装配置见 [工作流 MCP 文档](workflow-authoring-mcp.md)，端点仍是 `https://auto-parse-v2.vyibc.com/api/workflows/mcp`。AI 使用相同的正式流程：

1. `workflow_get` 确认 ID、节点、目标账号；`workflow_node_catalog` 查询新增 `image_upload` 和 `image_text_publish`。
2. `workflow_open_session` 传 workflowId、browserInstance、字符串 vars、confirmBrowserControl=true。
3. `workflow_run` 传 sessionId、expectedRevision、操作 requestId、confirmExecution=true。
4. 轮询 `workflow_get_session`，查看逐步结果和截图；停止/完成后 `workflow_close_session` 只关闭任务标签页。
5. 只有用户明确授权该素材公开发布，才传 directPublish=true。网络断开时查同一任务，不新建任务盲重试。

## 保护与验收边界

每个上传/准备/发布节点都要求服务端认证执行器持有浏览器锁；不接受用户变量伪造认证。上传进行 MIME 和大小验证，通过分块 CDP 注入有序 FileList；记录文件摘要、缩略图顺序和上传标识。准备和提交前校验当前登录账号、图片数量/顺序、标题正文和已应用的 AI 声明。

发布使用原生浏览器按钮，只点击一次；创建响应必须包含合法作品 ID，才返回 `published:true, postId, postUrl`。回执仅证明创建，不证明审核通过或公开可见。`.data/image-text-publications` 持久保存意图/回执，不能删除当作缓存。相同账号和源 URL 集合不会因更换 requestId 或重排顺序绕过去重；修改文案会报告冲突。未知提交结果必须人工核对，不能自动重发。此去重按 URL，不是跨 URL / 跨机器的全局图片内容去重。

已在真实登录浏览器通过两个正式流程完成双图上传、标题正文、AI声明、false 分支跳过发布和截图。true 分支使用明确测试占位图验证拒绝提交：`image_test_fixture_must_not_be_published`。仅为非发布测试允许固定 WORKFLOW_TEST 占位图，发布节点始终拒绝它们。

上线后再验证了小红书单图、抖音双图反向顺序，以及两平台 aiGenerated=false；两个生产任务均6/6完成、发布节点按条件跳过。公网页面也验证了任务恢复、浏览器选择、开关状态、执行记录和截图。最终202项组合回归、独立TypeScript、ESLint与生产构建通过。

**未进行公开图文发布验收**：用户没有提供本轮允许公开发布的图文素材。因此不能把“准备完成”写成“已发布成功”；两个平台的图片创建回执仍需用用户授权内容做最后一次端到端验收。没有为测试点击发布，也没有保证或声称测试内容已保存为云草稿。

回归：`node --test scripts/test-image-text-workflows.mjs`；同时运行原有工作流、上传清理、浏览器锁、抖音及小红书视频回归。
