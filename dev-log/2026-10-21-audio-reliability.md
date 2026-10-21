# AUDIO-003 音频搜索与 MCP 回归

## 范围与保护
- 用户要求页面功能与所有 MCP 接口正常；失败来源可停用。
- 仅在84的 /opt/auto-parse 修改。保护既有 .materials.json、app/api/parse/route.ts、lib/upload/r2.ts、ops/audio-library-build.env、tsconfig.json 与旧构建。
- 不新增付费生成，不代表用户确认现有素材质量和授权。写入成功路径先在隔离测试库验证；线上验证只读、无效参数及幂等已有完成请求。

## 已复现
- 页面音乐查询可命中缓存；音效/中文/无匹配查询约30秒后得到HTML 502。
- 页面直接response.json，且同词再次提交不请求；独立重试按钮与搜索按钮不是同一条路径。
- 既有单元9项通过不代表完整功能通过，旧验收不覆盖本轮失败场景。

## 进行中
- 复测来源与统一接口、补错误/超时/取消/分页测试，随后隔离构建与线上回归。

## 修复与验证
- `lib/audio-source-search.ts` 成为页面与CF REST/MCP公共搜索逻辑。默认Wikimedia，Openverse显式返回503并说明暂停原因，不删除已有资产/历史来源适配。
- 中文常用词映射、实测时长、授权筛选、分页；总数明确为本页匹配数，未知时长不通过时长筛选。不承诺所有Wikimedia结果适合作为BGM。
- 8秒上游时限、12秒页面时限、元数据2MiB限制、无匹配与上游错误分离、HTML/畸形响应转安全JSON错误；仅缓存成功公共结果。
- 同词再次提交和单独重试均发起新请求，取消旧请求，失败保留上次结果；公共Wikimedia不再要求先登录。私有API仍有Cookie/Origin门禁。
- Worker单元测试18/18，包括全部11个共享操作的隔离库成功路径；请求幂等、预算、人工验收门禁、未知态、防SSRF、搜索参数/响应/授权/时长边界。
- Worker/主项目TypeScript、变更范围ESLint、git diff --check、Next独立生产构建、Wrangler dry-run通过。
- CF部署 `85fca4e0-68ac-4292-bd37-c754deb61a7f`。实际默认搜索piano/footsteps/雨声/无匹配均成功，首次约0.5–0.9秒，缓存命中约0.05–0.14秒；不保证未来每次延迟。
- Next候选 `.next-audio-reliability-20261021`；当前实际生效构建指针是 `ops/workflow-mcp-build.env`（原 `.next-image-text-final-20261018`），已切换并重启服务。保留旧构建用于回退，未修改用户已有ops/audio-library-build.env内容。
- 最终公网脚本 `scripts/verify-reliability.mjs` **39/39**：11工具逐个调用、搜索/空列表/停用来源、登录、私有媒体实际播放、报价门禁、任务页、移动端、HTML502友好提示/保留结果、同词重试、筛选等。证据 `.data/audio-reliability-20261021/results.json`。
- /parse、/workflows、/audio-library 公网均200。未声称解析/发布业务完整流程已回归。
- 能力广场工具schema已更新为0.1.1，release `caprel-6e4147bb-6b80-4782-a580-ed21dbe09aba` / distribution `capdist-4a7055ce-f395-4baf-9788-ec68e15ce9f5`；首次读回状态delivering，不能提前宣称Harness已激活。发布适配器仅上传允许的name/description/inputSchema/outputSchema，不上传SDK annotations等额外字段。

## 验收边界与安全待办
- 线上generate/import仅原参数重放已有completed任务，确认reused=true，不创建新的付费或导入任务。update/review/use线上测不存在ID的拒绝路径；成功写入路径仅在隔离SQLite测试，未编辑或代为验收用户资产。
- 新付费生成、新导入及真实写入的完整验收仍待另行确认测试素材/费用，不能把39项通过解释为全部线上写入闭环通过。
- 候选测试第一次因本地Origin与生产CSRF不匹配失败，后改为通过真实HTTPS来源代理候选构建，生产防护未放宽。另一次MCP测试脚本错误地假定SDK参数校验错误一定为JSON，已修正测试解析器。
- 候选浏览器关闭时，测试脚本的未捕获route.fetch异常在会话工具输出中意外打印了服务Cookie。已在路由关闭处理捕获异常、等待路由结束，并限制失败日志；未把凭据写入仓库或证据JSON。已告知用户，服务凭据轮换及客户端重新连接待用户确认，不擅自使现有客户端失效。
