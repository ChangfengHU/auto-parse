# 自动发布插件：按自媒体平台分类

稳定插件ID：vyibc-auto-publish，当前版本0.3.2。统一入口Skill为auto-parse-publish 0.3.2。
能力广场：https://fleet.vyibc.com/#/hub?view=plugins&plugin=vyibc-auto-publish

## 四个平台，四个MCP

| 自媒体平台 | MCP ID | 专用端点 | 范围 |
| --- | --- | --- | --- |
| 抖音 | auto-parse-douyin-publish | /api/publish/mcp/douyin | 视频、图文、视频任务查询和对账 |
| 小红书 | auto-parse-xiaohongshu-publish | /api/publish/mcp/xiaohongshu | 视频、图文及任务会话回查 |
| X | auto-parse-x-publish | /api/publish/mcp/x | 文字、单图及持久创建回执查询 |
| 微信公众号 | auto-parse-wechat-publish | /api/publish/mcp/wechat | 官方API图文及原生贴图草稿、素材上传和查询；无群发或公开发表 |

四个端点均在https://auto-parse-v2.vyibc.com。公众号MCP固定版本0.1.1，其他MCP各0.1.0；插件版本与组件版本独立。
三个连接复用原AutoParse发布节点、正式Supabase工作流、上传与去重执行器。没有复制独立发布器。新版包内已移除通用auto-parse-workflow和带研究工具的vyibc-douyin连接；这些既有服务保留供其他用途，不被删除或撤销。

公众号使用官方API而非浏览器工作流，详见[公众号草稿箱](wechat-drafts.md)。新增连接不影响既有三个MCP版本；新版客户端需安装0.3.2并配置对应安全连接。40164白名单与真实草稿验收状态见专项日志，不因入驻即视为草稿创建通过。

## 认证与权限边界

每个平台使用不同的端点专用凭据，Vault引用为service:auto-parse-<平台>-publish及hub:connection:fleet-owner:auto-parse-<平台>-publish。凭据由当前工作流凭据作域分离派生，也可通过PUBLISH_DOUYIN_MCP_TOKEN、PUBLISH_XIAOHONGSHU_MCP_TOKEN、PUBLISH_X_MCP_TOKEN、PUBLISH_WECHAT_MCP_TOKEN单独配置。未配置根凭据时失败关闭。
平台凭据不能访问通用工作流MCP、其他平台或其他平台会话；请求Origin限制与现有服务一致。每个平台仅执行服务端批准的流程ID和浏览器实例；不开放任意节点编辑、创建或保存工作流工具。跨端点不能借sessionId转接或控制别人的会话。
抖音视频工具直接复用批准副本的保护适配器；任务查询与对账仅接受该副本的任务。发布仍核对账号、上传、文案、AI声明和持久去重。准备和公开发布分别要求对应用户授权，安装插件本身不授权发任意内容。
这些仍是所有者受信任连接，不宣称多租户账号隔离。此处只记录凭据名和机制，不包含实际Token。

## 安装与升级

~~~bash
bash <(curl -fsSL 'https://fleet.vyibc.com/api/hub/onboarding/packages/vyibc-auto-publish/0.3.2/install') codex
~~~

当前插件保留同一ID，旧0.1.0固定包与历史回执仍可读。旧版客户端需按原生安装器提示只卸载此插件的旧版本，再安装新版；不删除其他市场、插件或配置。安装器不会自动替用户卸载。
服务认证使用客户端安全连接，完整包有四个无密钥MCP模板；平台凭据不能互换，旧的通用连接令牌也不能用于新平台端点。安装与认证仍分开。Claude目标只提供plugin-dir启动方式；Dots、ChatGPT等客户端未在本次验收中实际安装，不据此声称已同步。

## 0.3.2原生贴图补齐

同一公众号MCP七个工具新增newspic草稿格式，Hub能力版本0.1.1，Skill与插件0.3.2。早报8张有序图片通过真实MCP保存，官方回读类型、顺序、首图封面及同请求重放通过，草稿仅增加1。微信后台草稿箱“贴图”页签也已看到准确标题；点击原生预览进入微信验证码页，未绕过验证，不把它记为完整原生预览成功。无公开发表、群发、GIF或Live验收。固定插件归档SHA256：a30ebe79bc287f0e72a157a58e79be9ef8c9e375ea5ee5f50ac5a2fd5795929d；插件登记d14d8956-7424-4577-85b8-e02037d3975b，MCP登记8a8912af-857c-425f-937f-cfeeb7863f37，Skill登记0e14e16e-ca6a-4b8a-97ff-3186d6688ad7。固定归档下载与无密钥模板检查记录在专项日志。

## 0.3.1验收说明补丁

沿用四个MCP组件0.1.0，公众号端点与凭据不变。更新入口Skill及插件至0.3.1，移除旧调用索引中“仍被40164阻塞、尚未创建草稿”的过期描述，加入已验证的代理与真实草稿验收说明。原生贴图/GIF/Live仍未接入。本次只更新发布资料，没有重启应用或产生新的业务草稿。0.3.1固定ZIP SHA256：f39f60cd8595b9c24dbc390f549b177e27fde6091156afb301856138ba05b6b7；插件回执e71add83-16d8-40e2-b045-1f3d422502db。固定包和隔离原生Codex安装已验证，详见dev-log/2026-10-29-wechat-hub-release.md。

## 0.3.0公众号扩展

新增auto-parse-wechat-publish 0.1.0，插件与入口Skill固定0.3.0，4 MCP + 1 Skill。公众号7工具部署后公网initialize、tools/list、capabilities通过。初次直连account_status返回40164；后续显式代理修复已完成生产认证、永久封面上传、一次测试草稿创建和同ID官方回读，稳定请求重放不重复创建。新增代理故障关闭验证后组合回归43项通过，独立类型/Lint/构建通过。专用Token对其他三个平台均返回401。草稿不等于公开发表。

固定插件ZIP SHA256：cbff4d2ceb9ad36e1854c7b87b355989ef448fbe9c9e25e789862404a3f30947。
固定Skill ZIP SHA256：97e0f642fd40b1c325d54fa6d21740745b38b806d73586042e27f325faedde1d。
插件更新回执02a07ea4-ae6e-4291-92e2-25f1599844e4；公众号MCP回执c38cfa95-9101-4f16-82e0-118d94e32966。固定包已下载并核验4个无密钥连接与新增指南，原生安装验证结果见专项日志。

## 历史0.2.0能力与验收分层

统一Skill内的targets.json是调用索引，运行时以实际MCP及Supabase为准。新平台增加专用MCP及同一插件的新版本；同平台新增视频/图文等类型沿用该平台MCP。不得以卡片改名代替真正的服务端权限边界。
原有验收范围不变：抖音视频、小红书视频和X单图有真实创建回执；两平台图文仅真实准备通过，公开图文提交未验收；X单图账号内链接回查不代表匿名可见或推荐曝光。没有为分类改造额外发布测试内容。
三个MCP分别发现13、9、10个工具；只读能力/流程查询、跨平台Token401、跨流程拒绝、真实空标签页会话归属拒绝及收尾通过。X专用端点成功读取此前已保存的原回执。生产只重启AutoParse，原浏览器和代理未重启。
12项平台隔离专项测试、完整组合回归、独立TypeScript、重点ESLint及生产构建通过。首次以服务用户构建遇到既有私密运行目录的权限拒绝，保留原权限后以既有管理方式完成构建；没有放宽私密目录权限。
新固定包已独立检查为3 MCP + 1 Skill，Codex隔离安装通过；安装不代表已取得服务授权。Hub原回执的installation字段仍表示Hub本身未运行客户端，本任务的安装证据另行验收。

历史0.2.0插件固定ZIP SHA256：ab5d5f1b552557193ee2509536a0392836278ae79657b310b241d99e66f693a3。
历史0.2.0 Skill固定ZIP SHA256：7670682ccafb617983267d405091cee88325b9640dd886a6d6f057f0bb15f8d0。
插件登记编号：ccf66c21-3381-4c18-ac2b-8c50056b72c0；Skill更新编号：e41f9963-c237-4eb4-965d-34465c3e3845。
源码位于lib/workflow/platform-mcp-*.ts、app/api/publish/mcp/[platform]/route.ts与skills/auto-parse-publish。

## 回滚

服务空闲并取得浏览器活动锁后，使用原构建选择文件切回保留的上一个构建，只重启AutoParse。保留所有发布账本，不删除去重记录或更换请求号重发。插件回退应遵循Hub新版本恢复流程，历史固定包不修改；不要把旧包重新标成当前版本。
