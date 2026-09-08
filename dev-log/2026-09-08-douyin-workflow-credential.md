# WORKFLOW-002 — auto-parse 抖音凭证发布前检查

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
