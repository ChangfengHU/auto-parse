# 自动发布插件

稳定插件ID：vyibc-auto-publish。统一入口Skill：auto-parse-publish。版本0.1.0，固定包来源由Hub持久回执管理。
能力广场：https://fleet.vyibc.com/#/hub?view=plugins&plugin=vyibc-auto-publish

## 安装

完整插件（含两个MCP声明和完整Skill）：

~~~bash
bash <(curl -fsSL 'https://fleet.vyibc.com/api/hub/onboarding/packages/vyibc-auto-publish/0.1.0/install') codex
~~~

安装器校验固定ZIP摘要，调用Codex原生marketplace/plugin安装并回读installed/enabled；同版本重复安装保持原目录。旧版本升级需先按安装器说明只卸载这个插件，不删除其他市场或能力。
Claude目标将保留固定源并给出claude --plugin-dir路径，不把它描述为全局自动安装。Dots/Web等客户端是否完成安装以对应客户端真实结果为准，本次只独立验证了Codex原生安装。

独立Skill可使用 https://skill.vyibc.com/install-auto-parse-publish.sh?ts=20261027094138；只装Skill不等于已安装两个依赖MCP，优先安装整包。

## 组件和认证

| 类型 | ID | 固定版本 |
| --- | --- | --- |
| MCP | auto-parse-workflow | 0.1.0 |
| MCP | vyibc-douyin | 0.3.0 |
| Skill | auto-parse-publish | 0.1.0 |

服务保持原部署：AutoParse工作流MCP位于https://auto-parse-v2.vyibc.com/api/workflows/mcp；抖音专用MCP位于https://fleet.vyibc.com/mcp/douyin。插件不会部署新发布器、复制Cookie、登录账号或新增浏览器。
安装与服务授权分开：使用客户端已经授权的对应服务连接。固定包只带无密钥MCP模板，mcp-auth.example.json只给出环境占位符；不能把Hub入驻令牌、Fleet或Vault管理令牌用于AutoParse认证。端点专用授权由Vault service:auto-parse-workflow-mcp管理，Hub精确端点绑定为hub:connection:fleet-owner:auto-parse-workflow。客户端是否支持环境占位符取决于其安全配置机制，不承诺安装器会自动注入凭据。

## 路由和范围

Skill内references/targets.json只维护索引与验收分层，不代替Supabase rpa_workflows。六条路线：

- 抖音视频：专用MCP复用批准工作流，已有真实创建回执验收。
- 小红书视频：工作流MCP，已有实发及管理页回查。
- 抖音/小红书图文：各自正式流程，真实准备通过，公开提交尚未验收。
- X文字：正式文字工作流，文字准备通过；共用执行器已通过单图实发。
- X单图：真实创建与登录会话中的独立作品链接回查通过。

支持输入、媒体/浏览器限制、AI声明与未知结果恢复见Skill参考文档。公开发布始终需要对应用户授权；安装插件不授权自动发任意内容。当前只提供既有浏览器发布路线，不宣称支持手机自动发布、免风控、定时或任意账号。

未来新增同服务工作流时更新同一Skill与路由；新增服务则登记固定MCP版本、更新requires、再发布同一插件的新版本。历史固定包保留，已有客户端须按其机制更新/重连，不承诺热更新。

## 本次验收

发布器完整校验并冻结6个Skill文件（14846字节），源码摘要358f65f8a2bd4ccd5613ff8a72281c0e0f8fac9d06560ac2c007fad972d48a31。
Skill固定ZIP SHA256：c11bac01ae971df5c6332cfb4496089a6ff11afd7e5aea37e25f3eccdc564707。
插件固定ZIP SHA256：108996072e7cb3946a9195c6f584d66cecebcaca2bb4634c3daa532a1755896a。
Hub登记编号：MCP 8b63f508-a2b7-4ab8-91da-99caed4e0903；Skill 732d1ea4-21e3-4673-aedd-8ab8bbe71fac；插件 a5198001-d01b-4270-bbb4-9954e3f677fc。
各项均先dryRun后同requestId提交，并回读原登记。

固定插件ZIP共17个文件、一个Skill完整6文件、两个MCP声明；JSON可解析、身份/版本一致、资源与参考文件齐全，未打入秘密。Codex0.164.0在隔离HOME/CODEX_HOME中实际原生安装，plugin list返回installed=true、enabled=true、version=0.1.0。该隔离安装没有修改用户原客户端配置。
公网两MCP均initialize/tools/list成功，发现17与25个工具；只读能力查询、六个正式工作流定位及此前真实X回执查询通过。此包装任务未上传新素材、未点击发布、未重启服务。
Hub自身receipt.validation.installation仍是not_verified，因为它不执行客户端安装；以上原生安装证据是本任务独立验收，不修改服务端原回执含义。未提交到OpenAI公开插件目录或其他平台。
