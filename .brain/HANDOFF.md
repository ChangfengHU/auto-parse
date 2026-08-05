# HANDOFF — auto-parse(接收协议)

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
