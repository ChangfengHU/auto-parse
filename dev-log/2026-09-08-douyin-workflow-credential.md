# WORKFLOW-002 — auto-parse 抖音凭证发布前检查

## 纠偏：使用用户已有 douyin-publish 与 84 创作者浏览器

- 用户明确拒绝新增工作流替代自己的原流程；本次完整读取 Supabase `douyin-publish` 的 13 个节点，而不是依赖旧摘要。原导航 useAdsPower=false 未绑定已登录浏览器；原素材为“好时光都该被宝贝”，不是本任务的一分钟视频。之前自行建立候选并围绕它开发偏离了用户指定入口。
- Vault 在 84 核验 Supabase 配置与原工作流身份后，把原工作流素材指向“给小花找太阳”，导航使用已有手动 CDP 参数 `http://127.0.0.1:9223`。保留所有原节点；验证期间暂禁第10–13步避免未核验就发布，结束已恢复这些节点原配置，读回深比较通过。修改前完整配置保留在 `.data/douyin-workflow-check/douyin-publish-before-browser84-20260908.json`，未写 Cookie 或密钥。
- 84 browser-2 实际创作者接口 status_code=0，UID 53017623213 / 唯伊不可，上传控件存在。只创建及关闭诊断页，无 Cookie 注入，无需扫码。
- 最小源码修复：navigate 手动 CDP 分支原来只有 adsProfileId 非空才向后续返回 newPage；改为有新浏览器就传递实际页面，跳过无关 AdsPower API 推导，只建任务页并在失败时清理。任务收尾只关手动模式自建页并断开 CDP，自动 AdsPower 分支保持旧生命周期。
- 通过 POST 正式任务 API 执行的 workflowId 为 `douyin-publish`，任务 `6bfd8080-dc7c-4bd0-bf8b-9e092d205269`：素材成功、手动接入成功、扫码节点识别已登录并跳过、导航上传页成功；第5步 setInputFiles 报浏览器关闭。没有执行任何发布点击。
- 84 journal 直接证据：2026-09-08 11:58:48 UTC，cdpguard 记录 instance 2 DevTools 9223 unreachable 并执行 restart browser@2。该脚本只进行两次各5秒 curl 探测，中间3秒，无任务占用判断；不能把本次关闭归因于登录失效、用户手动重启或工作流未接上。未擅改全机守护/代理/浏览器配置，上传时的短时无响应原因与守护兼容仍需继续处理。
- 未把“发布保护”改造成新流程；本轮未部署或替换原发布节点，原有 AI 声明、防重复与真实回执需求仍须在最终发布前落实，不能凭前四步通过宣布完成。
- 72/72 回归、相关 ESLint 和 diff-check 通过；未重跑全仓 tsc（已知历史错误仍待处理）。源码修复尚未生产构建切换，Supabase 浏览器配置即时生效。临时 auto-parse-douyin-check 已停，核实无人使用后删除 .next/dev，释放96000KiB（约94MiB），生产 BUILD_ID/服务不变；任务证据和账本保留，缓存可重建，无新增依赖。保护原 .materials.json 改动。

## 远程原浏览器验证（2026-09-08）

- 收尾：实现提交 `0ca8b6b` 已立即推送并核对 GitHub main 完整哈希一致。停止本次临时 `auto-parse-douyin-check`，核实无文件使用者后删除 `/opt/auto-parse/.next/dev`，释放 101496 KiB（约 99 MiB）；保留生产 BUILD_ID、运行服务、任务 JSON/截图及发布账本。缓存可由现有依赖运行 Next dev 重建；无新增依赖或 95 媒体副本。
- 用户扫码后，从 84 经回环反向 SSH 隧道实际访问 95 browser-3 创作者接口，status_code=0，账号 53017623213 / 唯伊不可，视频上传控件存在。只关诊断自建页，未覆盖 Cookie；不需要安装浏览器插件才能控制原会话。
- 按用户授权扩展现有节点和运行时：`useExistingBrowser` 连接服务端回环 CDP，在原 context 创建任务页；校验真实账号但完全跳过凭证查询及 Cookie 注入。保留本地隔离模式，不恢复 Fleet 门禁。进程级远程租约及外层浏览器活动 flock 防止本任务共享控制；不是生产分布式浏览器池。
- 文件上传支持 buffer（50 MiB 上限），避免把 84 路径交给 95 浏览器；仍在 84 下载并 finally 清理。首个正式 HTTP 任务 21171b6a-4d1f-4171-b915-04bf7ec6a03c 账号验证成功，setInputFiles 默认 30 秒超时，未执行发布节点；远程传输改为 180 秒后再次验证。
- 任务 c534c8d9-5d65-47a1-bb22-2a2badb8d5a2 再次验证同一账号，二进制传入完成并进入等待实际上传。2026-09-08 11:08:18 UTC，95 systemd journal 记录 browser@3 被 stop/start，任务报 Target page, context or browser has been closed。不是本轮发起的重启，具体操作者尚未确认；不能说视频已上传成功或登录失效。已向用户确认是否另一个会话在操作，暂停继续重试。
- Supabase 候选仍是 douyin-publish-sunlight-20260908，同一 materialId、视频、账号和 requestId；只更新远程模式及文件传输参数。写前用 Vault 在 84 核验配置与目标表，写后通过正式 API 校验。旧 douyin-publish、生产 11007 构建、Fleet MCP 未切换；无发布点击、无作品 ID，意图账本目录检查为空。
- 70/70 回归通过（远程端点限制、互斥释放、仅自建标签页、零 Cookie 注入、buffer 及大小限制/清理等），相关 ESLint 通过；全仓 tsc 仍是 task-store.ts 既有 11 项类型错误。所有修改只在 84 /opt/auto-parse；未安装依赖，未在 95 建立项目或保存视频。原有 .materials.json 修改未纳入提交。

## 当前修订：取消本地发布对Fleet门禁的依赖

- 机主明确说明该前置门禁不是需求，授权移除。本轮只取消auto-parse三处verifyDouyinDispatch调用与helper，不修改Fleet自身隔离表/代理/其他浏览器；下方不绕过隔离的历史要求不再限制本地工作流。保留实际账号、上传完成、内容检测、AI声明、独占意图及真实回执检查。
- 上轮通过正式API建立候选douyin-publish-sunlight-20260908，保留旧douyin-publish未替换；素材库仅追加已校验的给小花找太阳视频，未覆盖旧素材。任务75ce4d51-8fa4-46ee-af09-9f5d1ed995fa在全部节点开始前报fleet_dispatch_unavailable，不能解读为抖音登录失败。失败证据保留在.data/douyin-workflow-check；临时服务停止，.next/dev约107MiB已清理，生产构建保留。
- 本轮58/58回归通过，更新的测试明确禁止本地发布调用Fleet；账号不符、上传失败、AI声明缺失、未知回执及重复提交仍受保护。相关源码/测试ESLint与git diff --check通过。未新增依赖；准备复用84已有环境重跑同一素材、账号和稳定requestId。
- 按vyibc-ops从Vault核对SSH、Supabase和GitHub配置，在84确认正式候选工作流存在、运行环境与金库Supabase配置一致、GitHub目标仓库和push权限。实际发布结果待下文追加，不把单元测试作为作品发布成功。
- 门禁修复提交cca0f48已立即push并ls-remote一致。任务629c540f-2386-4988-9ae0-87e15c82642b实际通过目标账号及创作者上传权限，无需扫码；到编辑页面后明确显示上传失败，未点击发布。
- 发现先前清理逻辑过早：Playwright本地浏览器传入文件路径不代表异步上传已读完，原setInputFiles后两秒即删除。抖音页面改为等待真实上传结果再finally清理，新增异步读取/失败/超时清理测试。61项回归通过；任务d180e31d-ceb2-44db-99b7-62613f3b6bf1上传节点成功且截图有视频预览，后续发布节点publication_step_failed，未点击发布。不能把上传节点成功当作作品创建成功。
- 为下一次实际定位增加发布节点阶段错误码和失败截图，不输出原始异常中的敏感内容；沿用同一稳定requestId，不修改或删除发布意图账本。临时服务仅127.0.0.1:11008，生产11007未切换。
- 后续实测定位为AI声明确认；ea479bf3截图显示选项随后已选中，因此不能把即时isChecked=false说成最终未选中。去掉隐藏input强制点击与旧预览文案硬匹配，改为点击可见label、等待同一input的checked状态，再确认。待真实整链复验。
- 修复失败节点截图被task-store丢弃的问题：setTaskStepError接收并持久化已有NodeResult.screenshot，复用原任务证据不另建目录。新增截图持久化与AI未选中必须停止测试；63项回归通过。全仓tsc仍为task-store.ts既有11项PersistedTask类型错误，没有新增类型错误，不能宣称全仓通过。
- add8bb7已立即push且ls-remote一致。a7d88d93-874b-47c0-8cd9-0a9c77c7d747上传等待600秒超时，失败截图明确为创作者登录页：这是本次前置账号核验成功后又回到登录页，不能说所有历史登录失效，也不能断定95来源浏览器掉线。补充上传中登录丢失的明确失败分类，防止继续空等；本轮停止重试，不要求用户重复扫码，后续先核查已有登录来源。
- 尚无作品创建回执；AI声明控件兼容未通过线上验收。正式生产11007与Fleet MCP仍未切换，不把临时HTTP实测或测试通过当作全量上线。
- 收尾64/64回归、相关ESLint和diff-check通过。临时auto-parse-douyin-check服务停止，核实无使用者后清理.next/dev 110872KiB（约108MiB），删除本次/run/systemd临时超时配置；生产构建与唯一任务截图/记录保留。缓存可通过现有源码/依赖重新生成。未安装依赖，95未创建工作副本或媒体文件。

## 目标与边界

执行归属是 auto-parse 正式 Supabase 工作流；Fleet 仅提供账号发现、凭证同步和 MCP 入口。
不得绕过工作流直发，不得把上传成功、页面跳转或模拟测试当作作品创建成功。
用户指出 Fleet 已识别账号：不能再把“需要验证执行端权限”表述为“用户需要重新登录”。

## 本轮实现

- 扩展现有 `credential_login`，新增可选 `verifyDouyinCreator` 和 `expectedAccountId`，
  并在节点目录提供说明。默认不开启，保留旧工作流输出和参数行为。
- 新模式从既有 `douyin_sessions` 取凭证，注入后核对创作者 API 的 UID 和视频上传控件。
  无效参数、缺失凭证、账号不符、登录失败、网络/接口故障、无上传控件均失败返回；
  不因 `strict:false` 跳过，不引导扫码，不输出 Cookie、凭证值或原始异常内容。
- 本地 `/home/claude/repos/auto-parse` 与 84 `/opt/auto-parse` 分别实现，
  未通过 scp/rsync/pull 或本地文件/补丁同步覆盖远端。业务逻辑一致，远端注释略有差异。
- 84 既有 `.materials.json` 修改保留，未纳入本任务。

## 实测

- Fleet 95 browser-3 创作者接口与上传控件验证成功；无需扫码。
- 通过现有 MCP `sync_login` 成功同步到既有 auto-parse 凭证库，仅输出成功元数据。
- 在 84 新建临时隔离 Chromium，调用远端真实 `executeCredentialLogin` 源码的新模式，
  返回 `success:true, creatorVerified:true`，UID 与已选账号一致，工作流变量为空。
  凭证只在进程与临时浏览器内使用；创建接口被诊断显式阻断，关闭临时浏览器收尾。
  这是源码节点级真实验证，不是生产 Next.js HTTP 接口或完整工作流验收。
- 本地 `node --test scripts/test-douyin-credential.mjs`：21/21 通过，
  覆盖迁移成功、失败分类、错误脱敏、无效输入零动作、旧行为兼容。
- 两端新 helper/凭证节点 Lint 通过；本地测试脚本 Lint 通过。
- 全仓 TypeScript 检查不通过：本地 11 个 `task-store.ts` 类型错误。
  用内存编译器加载 HEAD 原始版本对比，同样 11 个错误；此次没有新增类型诊断。
  远端也报同一文件的历史类型错误，不宣称全仓通过。

## 尚未完成

- 没有修改 Supabase 正式工作流；原流程仍引用旧素材与 AdsPower 分身。
- 没有构建/重启生产 auto-parse；当前 HTTP 服务仍运行旧构建。
- 没有把 Fleet 发布 MCP 改为启动 auto-parse 工作流。
- Fleet 隔离状态没有被修改；后续真实业务派发需正常恢复，不可通过直连绕过。
- 视频没有上传或发布；没有新作品 ID，原有稳定发布请求 ID 不应盲目替换。

后续：确认部署窗口，完成正式工作流的素材参数、上传完成/内容检查/AI 声明与真实创建回执，
再接 MCP 入口并做整条链路验收。此任务保持 In Progress。

## 2026-09-08 单工作区与资源清理

机主取消双环境维护：后续仅在 84 `/opt/auto-parse` 开发。95 工作副本、视频中间产物、上传测试副本已删除，本轮约225 MiB，加上之前依赖约875 MiB。23个R2媒体对象逐文件下载与SHA-256比对一致；46份制作记录和截图校验后保全到本机 task-recovery。原未提交源码/记录在恢复目录保全；本次仅归并新增测试、日志和Brain映射，没有覆盖84既有运行时代码及素材修改。恢复目录归并完成后清理。

此前的21项测试记录为95历史证据；84测试结果将在实际运行后追加。视频仍未发布。

- 本轮已在84正式源码目录运行 `node --test scripts/test-douyin-credential.mjs`：21/21通过；helper、凭证节点与测试脚本 ESLint 通过。没有重装依赖。
- 95仅负责发起SSH，所有后续业务开发、测试、构建均在84。

## 金库认证、合并和临时文件回归

- 84提交4bb4679首次push因本机未配置认证失败；随后使用Vault service:github进程级认证，得到非快进拒绝（远端已有8c762fd），不是认证失败。
- 机主授权fetch并合并；远端仅新增API-002历史任务和2026-08-29日志，merge自动合并成功，双方内容保留。未force/reset/stash；原有.materials.json修改哈希不变，不纳入提交。
- 上传节点使用独占临时目录、pipeline处理下载流错误和空闲超时，成功/HTTP失败/流中断/控件失败/截图失败均在finally清理，移除延迟5分钟的清理定时器。新增5项真实本机HTTP测试，与21项凭证测试一起复验。
- 金库认证前置规则写入AGENTS.md；推送与验证以本轮命令结果验收。仍未生产构建/部署，未修改Supabase正式发布工作流，视频未发布。
- 合并工作树在84复验：26/26测试通过，5个相关源码/测试文件ESLint通过，暂存区与工作树diff-check通过。机群84的proxy.fresh_exit故障仍为task_blocked、业务调度隔离未解除，正式发布尚未验收。

## 正式发布节点、隔离执行与恢复副本收尾

- 新增并注册 `douyin_publish`，沿用引擎执行页与已验证凭证/素材/上传输出；没有调用独立发布器。严格等待真实上传完成、内容检测通过、AI自主声明可见，再执行唯一发布按钮。
- 提交前及浏览器启动前检查Fleet节点身份/可达/隔离状态；正式发布工作流使用任务独立Chromium，拒绝混入AdsPower/CDP切换，创建页面失败也关闭任务浏览器。旧流程的启动策略保持原样。
- 固定requestId+账号的独占持久化意图先于点击落盘；内容/AI声明变化拒绝复用，未知结果不自动重试。仅接受创作者创建接口成功响应内的真实作品ID，拒绝不安全数值精度。获得ID仍不代表平台审核通过。
- 84运行四个测试脚本共60/60通过，包含实际节点源码与任务启动函数的隔离模拟、AI声明缺失/上传失败/内容失败不点击、重复/未知回执、调度隔离、浏览器释放，以及真实本机HTTP下载清理。模拟UI尚未在生产抖音页面实测。
- 新增helper/节点/测试ESLint及diff-check通过；全仓类型检查仍需如实记录历史task-store.ts错误，不宣称全仓通过。未安装依赖，临时测试文件finally清理。
- 84恢复副本清单无独有文件；凭证运行时代码仅注释差异，历史材料文件无修改，4ad4f43含原分支及远端提交。确认lsof无使用后精确删除 `/home/claude/task-recovery/auto-parse-95-20260908`，约8.1MiB；约1264KiB唯一制作记录保留。95已确认清理项未重新创建。
- 仍未构建/重启生产服务，未修改Supabase工作流，未接通Fleet MCP，未上传/发布本次视频；需要FLEET_NODE_ID配置及后续整链验收。84新鲜proxy.fresh_exit检查仍失败，修复需沿正常Fleet流程，不能解除隔离绕行。
- 收尾复验：60/60再次通过，ESLint和diff-check通过；`tsc --noEmit --incremental false`只有原task-store.ts的11项历史错误，无新增诊断。Vault-first在84核对GitHub身份/仓库push权限后提交 `a00eae58ecd8adf77f61d2a06913dde79e474a18`，立即push并以ls-remote核对同一哈希；原.materials.json哈希仍为481b54a148b0f606457836ebee98d6ff21819a33a5d8d7050257dd37b756f6a6。07:49 UTC只读复查84仍dispatchHeld=true，95已确认删除路径仍不存在，磁盘约17GiB可用。

## Fleet正常恢复尝试（08:10 UTC之后）

- 机主确认按现有Fleet流程修复并复验84；范围明确保留现有线路、账号、预期出口与浏览器，不轮换凭据、不绕过隔离。Vault先核对ssh:host-84-8-217-45登记，再通过原incident的retry API请求第5轮，没有另建故障或修改隔离表。
- 故障 inc-dfc8b5926989c3851bfdb7b1；Signal后缀opened.v5；复用Task T-intake-19a1242874c28daa，新批次b-intake-75094177868a1642。限制已通过operator_retry_reason原样进入任务事实。
- 执行器实际调用fleet_onboard_start/report/status。新事务onb-45e970db-6a09-4270-8149-513ee6ec9e32的阶段1–3健康复用；08:14 UTC阶段4 resource-snapshot返回dependency-unavailable/needs-user，can_resume=false，报告尚未生成。执行者task_block，未进入阶段5代理恢复，不重发同一失败动作。
- 只读排查：84的8792健康接口ok=true、version=0.15.1，而固定门禁要求0.15.8。宿主stage4结果只含通用失败码，缺少下载/传输/安装子步骤。目标相关配置文件mtime仍为此前日期，没有证据表明本轮已升级或改动代理配置。
- 按执行器真实User-Agent、禁重定向及同一URL检查三个固定制品：HTTP200且SHA256一致；本地deployment_material校验通过；使用宿主known_hosts的SSH true和SFTP pwd通过。最初使用Python默认User-Agent的403不是执行器同条件证据，不能用它判定此次下载失败。
- 仍缺具体失败原因，需要共享Fleet固定执行器补充分阶段脱敏诊断后再受控恢复；不能用上述当前只读成功冒称历史事务成功。自动发布、生产部署和MCP切换依旧未完成，视频未发布。
# 本轮收尾：已发布回执与丰富字段（2026-09-08）

- 原作品 https://www.douyin.com/video/7683141951113219337 已经发布。原任务 26d43efb-66c1-47bd-8c18-86f038336b86 的创建响应未被识别，错误历史保留；只读作品列表严格核验后补充 publication 回执，正式 API 返回 published。本轮没有重新点击发布，也未修改已发布文案。
- 原生响应 parser 新增根 item_id 并在 JSON 解析前保留大整数字符串；实际作品列表 numeric item_id 精度丢失已观察到，但原始 create 响应未留存，不能断言它就是全部原始原因。
- 用户原 douyin-publish 冻结。授权副本 34f421be-f97c-498a-9c80-5214564abd1c 继承原 13 节点，运行时只投影白名单字段；材料节点显式 URL/标题、私有视频分块传入浏览器、真实账号/上传/AI声明/防重复机制继续复用。未调整 cdpguard、代理或 Fleet 隔离表。
- 新管理员 API 提供 capabilities、prepare、publish、get_task、reconcile；请求预留 wx、防重复账本、元数据指纹与未知结果禁止重试。旧任务终态证据按明确 ID、COPYFILE_EXCL 迁入正式 task store；不覆盖已有不同证据。
- Slate fill 实测会追加旧内容，改键盘全选清空后填写并读回比对。基础预览 8ce83dd2-36c7-40c8-83e8-945fd83773de 完成，标题/独立描述/两个话题文本/AI声明通过，prepared=true、published=false。未测试新的真实发布以免重复发片。
- 封面支持受限 HTTPS PNG/JPEG 图片输入、8MiB 内存上限，仍 experimental。v1 被本会话诊断误开弹窗干扰；v2 修正封面定位；v3 仍在封面加载/完成阶段 timeout，未发布。原生话题实体选择、视频时间点截帧封面未实现，不能宣称全部丰富能力验收通过。
- 62 项定向测试通过（含预览不点击/不占发布账本），全仓 tsc --noEmit 通过；生产候选构建通过。正式服务已使用 NEXT_BUILD_DIR=.next-douyin-release，公网已验证 capabilities 200、原任务 published、新任务 prepared、未认证 401。原 .next 暂作短期回滚，运行依赖和防重证据保留。
- Fleet 复用既有 vyibc-douyin 广场登记，7 个工具由 linux-clash 项目适配；跨机器配置已保存 Vault service:auto-parse-workflow，使用既有管理员令牌，未轮换凭据。
- Fleet 公开 MCP 七工具、能力查询、published 与 prepared 回查均已实测通过；原件深比较未变。临时 11008/11009 服务已停止，清理本任务 `.next/dev` 124384 KiB（约121.5MiB），可由现有源码/锁文件重新生成；上传临时文件已自动清理。当前生产 `.next-douyin-release` 约156.4MiB 必须保留；旧 `.next` 约146.6MiB 暂供部署回滚，稳定验收后再清理。唯一工作流证据、发布防重账本与用户 `.materials.json` 修改保留。
