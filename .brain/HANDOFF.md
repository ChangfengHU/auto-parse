# HANDOFF — auto-parse(接收协议)

## 机主最新接收约定（2026-09-08）

开发工作区仅为 `84.8.217.45:/opt/auto-parse`。从 Vault 的 SSH 配置定位并登录后，执行 `systemctl show auto-parse -p WorkingDirectory -p ExecStart` 和 `git status --short` 获取实况；不要按下方历史实例表在 95 克隆项目。机主已取消双环境开发要求。

规范以 AGENTS.md 顶部最新约定为准，状态读 TASKS.md 与 dev-log/2026-09-08-douyin-workflow-credential.md。运行环境变量由 `/etc/auto-parse.env` 提供，只读变量名和引用位置，不回显值。机群登录由 Vault/Fleet 发现与同步，auto-parse 正式 Supabase 工作流执行发布。

本地发布不依赖Fleet调度状态，不要求FLEET_NODE_ID；机主已明确取消这项新增前置条件。以实际账号、上传权限和真实创建回执验收；不得把历史Fleet隔离记录重新解释为本地执行禁令。Fleet自身调度机制不在此次修改范围内。

### 当前入口：用户原有工作流

Fleet 的 `vyibc-douyin` 调用本服务 `POST /api/douyin/workflow`，不再由 standalone node publisher 执行新发布。调用配置通过 Vault `service:auto-parse-workflow` 取得；令牌仍是执行端 `/etc/auto-parse.env` 的既有 AUTO_PARSE_ADMIN_TOKEN，不回显。先 capabilities 核对账号与字段限制，prepare 只准备不发布；publish 另需显式 confirmPublish。固定 requestId 并通过 get_task 轮询，业务 publication 回执与原工作流执行历史分开返回。

已提交但原响应未知时，先取得真实作品 ID，再 reconcile 按精确字符串 ID、账号、标题、时间及唯一作品列表项只读核实。不得把大整数 item_id 转为 JavaScript Number；不得以 toast、上传完成或审核进度当作品创建证据。任务与账本位于 `.data/workflow-tasks`、`.data/douyin-publications`、`.data/douyin-workflow-requests`，是防重和验收证据，不是可清理缓存。

生产构建路径以 `systemctl cat auto-parse` 与 NEXT_BUILD_DIR 为准。使用现有依赖侧建 `NEXT_BUILD_DIR=.next-douyin-release npm run build`，独立端口验收，再确认无运行任务后切换 systemd；保留旧构建用于短期回滚，稳定后核实清理。封面须看 capabilities.verification，实验入口不代表 UI 验收通过；当前 # 话题是 caption_text，不承诺原生话题关联。

先 GET `/api/workflows/douyin-publish` 读完整正式配置。原件冻结；机主最新授权确需修改时调用 POST `/api/workflows/douyin-publish/copy`，保留原结构，只改副本，执行前后深比较原件未变，不自行新建另一套候选替代。使用原导航节点已有 `useAdsPower: true` 与 `adsManualCdpUrl` 接口指向实际执行机器上的已登录浏览器；当前由机主选择 84 browser-2（9223）。手动 CDP 新实现跳过 AdsPower 探测、不依赖分身 ID，只新建任务页；原始登录页不关闭。旧配置的分身字段可保留兼容尚未部署的新实现，但不应当作当前登录身份。

浏览器与执行器不同系统账号时，核验浏览器能否读取任务临时视频路径；不要放宽整个临时目录权限。副本的 file_upload 使用已有 `transferMode: buffer`，不依赖浏览器读执行器私有文件。发布点击可显式配置 `douyinPublication`，复用真实账号核验、上传完成、AI 声明与单次回执逻辑；普通 click 不受影响。抖音 Semi Radio 的真实选择状态可能在 `semi-radio-checked` 类而不是隐藏 input.checked；确认后同名声明可同时出现在字段与预览，不按唯一全文文本判断。

若源码仅在临时服务验证，而生产仍不支持新发布参数，启动验证任务取得固定快照后，暂停副本后续发布节点，避免旧生产解释器忽略参数而裸点击发布。发布账本结果不明时不得重试；先核对目标账号作品。

实际创作者身份用 `/web/api/media/user/info/` 与上传控件核验，不以普通抖音页面或 Fleet 标签代替。遇到 `Target page ... closed`，先核对 browser 服务的启动时间与 cdpguard journal；两次探测超时导致守护重启不同于用户退出登录。本任务尚未授权改造全机守护或关闭所有浏览器保护，先确定浏览器级作用范围。

### 历史可选能力：远程原浏览器验证方式（不是当前任务路线）

机主授权 84 工作流使用 95 已登录 browser-3，不再以跨机器迁移 Cookie 为前提。服务端显式设置 `WORKFLOW_REMOTE_CDP_URL`，只允许运营方建立的 `127.0.0.1` HTTP/WS 端点；不从工作流接受任意 CDP 主机。既有 `credential_login` 节点配置 `platform: douyin`、`verifyDouyinCreator: true`、`useExistingBrowser: true`、经确认的 `expectedAccountId`；删除无用的 credentialId 输入。`file_upload` 使用 `transferMode: buffer`，最大 50 MiB，传输时限 180 秒。

从 95 建立到 84 的反向 SSH 隧道（`-R 127.0.0.1:19224:127.0.0.1:9224`），外层持有 `/run/linux-browser-vnc/activity-9224.lock`，直到任务结束及任务页关闭。服务进程内另有远程端点互斥；不是跨进程/跨机器租约，生产池化调度尚未实现。任务只创建并关闭自己的标签页，结束断开 CDP，不关闭原始会话或覆盖 Cookie。浏览器仍可能被不遵守活动锁的外部操作重启：检查 `systemctl show linux-browser-vnc-browser@3` 和对应 journal 后再判断故障，不把 Fleet 登录标签或历史 Cookie 当作实际创作者会话证明。

验证须 POST `/api/workflows/tasks` 执行机主明确指定的 Supabase 工作流或获准的原件副本，不从脚本直接调用发布器或自行新建候选代替；保留原 requestId 和 `.data/douyin-publications`。临时 Next dev 仅作源码验收，不等于生产部署；用完停服务并核实清理 `.next/dev`，保留唯一任务证据。

本文件的唯一职责:**零上下文的新 agent 如何从一无所有到接管本项目**。
它不是进度报告、不是任务清单。任务看 `TASKS.md`;发生过什么看 `dev-log/`;
踩坑经验看 `experience/`(**接手前必读**,它就是本项目的 wiki 前身)。

硬规则:**只记方法不记快照**。本文件不写"哪台机器活着/当前版本是什么"——
用下面的探测命令查实况。文档里任何写死的 IP/URL 都可能已过期,以探测结果为准。

更新触发器:只有世界结构变化(新机器、新密钥位置、新服务、新约定、验证方法变化)。

---

## 这是什么

Next.js 全栈自动化平台:视频解析/发布、浏览器自动化工作流、Gemini 网页生图、
批量任务。源码权威:`https://github.com/ChangfengHU/auto-parse`(私有)。

**关键认知:这个仓库有多个互相独立的部署实例**,不同实例只用到代码的不同子集:

| 实例 | 机器 | 用途 | 实况探测(不要信文档,跑命令) |
|---|---|---|---|
| suqu 生产解析 | `206.189.196.65:/opt/auto-parse` | 小程序链路的解析后端 | 由 **suqu-control-plane** 仓库治理,凭据/雷区/验证命令都在那边的 HANDOFF |
| 本地 dev 常驻 | 本机(hostname `FDXW`)`/root/auto-parse` | 开发/调试,`next dev` | `systemctl is-active auto-parse.service && curl -so /dev/null -w '%{http_code}\n' http://127.0.0.1:1007/`(活着应输出 3xx/200) |
| 生图机群 183 | `34.29.222.183` | AdsPower 多分身 Gemini 生图 | `curl -so /dev/null -w '%{http_code}\n' https://parse-183.vyibc.com/`(530=隧道/机器已死) |
| GCP 云端开发 | `34.71.195.210` | VNC+AdsPower 桌面开发环境 | `curl -so /dev/null -w '%{http_code}\n' https://autoparse-dev.chxyka.ccwu.cc/` |
| sop-runtime | `152.32.214.95` | 见 `~/.ssh/config` 别名 `sop-runtime-95` | `ssh -o BatchMode=yes sop-runtime-95 hostname` |
| Docker 部署线 | 任意(阿里云 registry) | `deploy/` 三脚本,镜像名 `vyibc/doouyin` | 依赖 `.env` 中 DOCKER_*/REMOTE_*,见下 |

## 资产与访问

- **GitHub 仓库**:本机凭据可读写(验证命令见下)。
- **运行时密钥**:代码按功能需要以下几组环境变量(名字用
  `grep -rhoE 'process\.env\.[A-Z0-9_]+' app lib components | sort -u` 随时重取):
  - AdsPower:`ADS_API_URL/ADS_API_KEY/ADS_INSTANCE_POOL_IDS...`
  - AI 供应商:`GEMINI_API_KEY / OPENAI_API_KEY(+BASE_URL) / DEEPSEEK / QWEN / XAI / VERTEX_*`
  - 存储:阿里云 `OSS_*`、Cloudflare `R2_UPLOAD_URL/R2_UPLOAD_TOKEN/R2_PUBLIC_DOMAIN`、`SUPABASE_*`
  - 业务:`XHS_*`(小红书 CLI)、`SUQU_WECHAT_PROXY_TOKEN`、`DOUYIN_COOKIE`
  - 部署:`DOCKER_USERNAME/DOCKER_PASSWORD/REMOTE_HOST/REMOTE_PASSWORD`(`deploy/deploy.sh` 读 `.env`)
- **本机现状**:只有 `.env.local`(仅 `NEXT_PUBLIC_DEBUG_VNC_URL`)。
  **全量密钥本机不存在**——TODO(问用户: 完整 `.env` 的权威副本在哪台机器/哪个保险库?)。
  R2 上传凭据与部分 Cloudflare 凭据可在 `suqu-control-plane/secrets/` 取得(见其 SECRETS_INDEX)。
- **机器访问**:65 的 SSH 私钥在 suqu-control-plane;`152.32.214.95` 的 ssh config 条目存在但
  当前 key 被拒——TODO(问用户: 95 的访问凭据从哪拿,或该机器是否已弃用?);
  183 与 GCP 开发机无本地凭据——TODO(问用户: 是否还在运营?)。
- 密钥值绝不写入本文件与任何文档;新增密钥落 600 权限文件并回此登记名字与位置。

## 接手阅读顺序

1. 本文件
2. `AGENTS.md`(仓库规则与两套开发环境;注意其中 IP/URL 需用上表探测校准)
3. `experience/`(踩坑记录,必读:AdsPower 端口机制、Playwright 进程泄漏、CF key 认证格式、磁盘扩容)
4. `docs/architecture.md` → 按目标实例读 `docs/CLOUD_LOCAL_DEV.md` / `docs/MACHINE_183_ENV.md` / `deploy/README.md`
5. 若动 suqu 生产解析:先读 `suqu-control-plane` 的 HANDOFF 与 wiki,那边规则优先

## 如何验证已接管成功

以下命令 2026-08-04 全部实跑过,与版本无关:

```bash
# 1. 仓库可达(本机凭据)
git ls-remote https://github.com/ChangfengHU/auto-parse.git HEAD >/dev/null && echo repo-ok

# 2. 本机 dev 实例
systemctl is-active auto-parse.service          # → active
curl -so /dev/null -w '%{http_code}\n' http://127.0.0.1:1007/   # → 307(重定向即活着)

# 3. 各远端实例实况(逐个跑上表探测命令;530/超时=该实例已死,与接管无关,记录即可)

# 4. suqu 生产解析实例(需 suqu-control-plane 凭据)
curl -si -X POST https://auto-parse-65.vyibc.com/api/parse | head -1   # 无参应 4xx,连通即可
```

1 和 2 必须通过;3、4 是绘制实况地图,不是通过条件。

## 雷区

- **文档里的 IP/公网入口大量过期**(写下即腐烂的教训):一切以探测命令为准,别按旧文档 SSH/调用。
- 本机走 clash/TUN(198.18.0.1 网卡),`curl ifconfig.me` 出口 IP ≠ 本机身份,别用它判断机器。
- AdsPower Local API(50325)**必须有人在 GUI 登录后才激活**;生图机群需在 VNC 里完成
  各分身 Google 登录(Pause Point B),否则生图必败。详见 `experience/adspower.md`。
- Playwright 长跑会泄漏 `chrome-headless-shell` 进程直至内存耗尽,已有 watchdog 机制,
  改浏览器相关代码前读 `experience/playwright-headless-leak.md`。
- Cloudflare `cfk_` Global Key 不能用 `Bearer` 认证,见 `experience/cloudflare-api.md`。
- 本机 `auto-parse.service` 是 **`next dev` 常驻**(非生产构建),日志 append 到 `.run.log`
  (工作树里它长期是脏文件,属正常,别为它 commit,也**别 reset 工作树**)。
- suqu 生产实例(65)的雷区以 suqu-control-plane 为准(那边同样禁 reset 脏工作树)。
