// ─────────────────────────────────────────────────────────────────────────────
//  Workflow Engine – Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

export type NodeType =
  | 'material'        // 业务：从素材库选择素材并输出变量
  | 'navigate'        // 基础：导航到 URL
  | 'text_input'      // 基础：文本填入
  | 'paste_image_clipboard' // 基础：将图片 URL 写入剪贴板并粘贴到目标输入区
  | 'press_hotkey'    // 基础：执行快捷键（用于验证输入框聚焦/快捷键是否生效）
  | 'click'           // 基础：点击元素
  | 'scroll'          // 基础：滚动页面或滚动到元素
  | 'screenshot'      // 基础：截图快照
  | 'file_upload'     // 高级：URL → 下载 → 注入 <input type=file>
  | 'wait_condition'  // 高级：轮询 + 条件判断（值/URL/元素存在）
  | 'qrcode'          // 高级：截取二维码 → 等待扫码成功（URL 跳转判断）
  | 'human_pause'     // 高级：暂停等待人工操作（验证码/拦截页）
  | 'extract_image'   // 高级：提取页面图片 → 下载 → 上传 OSS
  | 'extract_image_clipboard' // 高级：剪贴板中转提取高清图片（解决 blob: URL 问题）→ 上传 OSS
  | 'extract_image_download' // 高级：点击下载按钮并捕获下载事件 → 上传 OSS
  | 'xhs_download'   // 高级：小红书帖子图片/视频批量下载 → 上传 OSS
  | 'localhost_image_download' // 高级：本地解析页面图片批量下载 → 上传 OSS
  | 'localhost_image_download_debug' // 调试：本地图片批量下载调试版本
  | 'credential_login' // 高级：按凭证 ID 拉取并注入平台 Cookie
  | 'workflow_call' // 高级：把现有工作流当作节点执行（支持并发多次调用）
  | 'metaai_generate' // 高级：调用外部 Python 脚本执行 Meta AI 生成视频并上传 OSS
  | 'gemini_parallel_generate' // 高级：并发打开多个 Tab 同时触发 Gemini 生图
  | 'vertex_ai' // 高级：Vertex AI 聚合节点，封装生图/参考图编辑/生视频等能力
  | 'topic_picker_agent' // 高级：调用 DailyHot 技能并评估选题，输出 TopN
  | 'agent_react' // 高级：通用 ReAct Agent（LLM + 工具/skill 循环）

// ── 节点定义 ──────────────────────────────────────────────────────────────────

/** 节点执行完成后的等待条件（每个节点都可配置，默认关闭） */
export interface WaitAfterConfig {
  enabled?: boolean             // 是否启用（默认 false）
  delaySeconds?: number         // 延迟多少秒后再开始判断，默认 0
  urlContains?: string          // 等待 URL 包含此字符串
  selector?: string             // 等待元素出现/消失（CSS 或 XPath）
  action?: 'appeared' | 'disappeared' | 'url_match'
  timeout?: number              // ms，默认 15000
  failKeywords?: string[]       // 页面含任一关键词则判定失败
  successKeywords?: string[]    // 页面含任一关键词则判定成功（优先）
}

export interface NodeDef {
  id?: string                        // 可选 ID，用于引用
  type: NodeType
  label?: string                     // 展示给用户的名称
  params: Record<string, unknown>    // 节点参数（支持 {{变量}} 模板）
  continueOnError?: boolean          // 失败时是否继续（默认 false）
  url?: string                       // 执行前自动导航到此 URL（空则不导航）
  waitAfter?: WaitAfterConfig        // 执行后等待条件
  autoScreenshot?: boolean           // 执行后自动截图（默认 true）
}

// ── 节点参数类型（各节点 params 的具体定义）────────────────────────────────────

export interface NavigateParams {
  url: string
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'
  timeout?: number
  useAdsPower?: boolean            // 是否开启 AdsPower 模式（UI 渲染为开关）
  adsProfileId?: string            // AdsPower 分身编号，如 k1aomp3q
  adsApiKey?: string               // AdsPower API 密钥（Local API Key）
  adsApiUrl?: string               // AdsPower 本地接口地址，默认 http://127.0.0.1:50325
  adsManualCdpUrl?: string         // 终极方案：手动填入已打开浏览器的 CDP 地址 (ws://...)
  adsProxyServer?: string          // 选填：强制透传 --proxy-server（例：http://host:port）
}

export interface MaterialParams {
  materialId?: string
  outputVideoVar?: string
  outputTitleVar?: string
}

export interface TextInputParams {
  selector: string
  value: string
  /** 输入模式：fill=整段填入；type=模拟键盘输入。默认 fill（未设置时可能跟随 humanOptions.humanType） */
  inputMode?: 'fill' | 'type'
  clear?: boolean   // 是否先清空（默认 true）
  delay?: number    // 每字符延迟 ms（模拟人工输入，默认 0）
}

export interface PressHotkeyParams {
  /** 可选：先聚焦该元素再按快捷键；为空则直接在当前焦点按键 */
  targetSelector?: string
  /** 要按下的快捷键（Playwright 键盘语法），例如 Alt+A / ControlOrMeta+A */
  hotkey: string
  /** 是否点击输入框以确保聚焦（默认 true） */
  clickToFocus?: boolean
  /** 是否尝试 bringToFront + window.focus（默认 true） */
  ensurePageFocused?: boolean
  /** 按键前等待（ms），默认 0 */
  waitBefore?: number
  /** 按键后等待（ms），默认 200 */
  waitAfter?: number
  /** 重复次数，默认 1 */
  repeat?: number
  /** 是否校验“选区确实发生变化”（默认 true）。失败时会走 fallback。 */
  verifySelection?: boolean
  /** 校验失败时：自动尝试 Meta/Control 的替代组合（默认 true） */
  fallbackOnNoEffect?: boolean
  /** 最后兜底：用 DOM Selection API 强制全选（默认 true，仅对 A 生效） */
  domSelectAllFallback?: boolean
}

export interface PasteImageClipboardParams {
  imageUrl?: string
  imageUrls?: string[] | string
  /** 执行模式：auto=先尝试粘贴，失败再上传；paste=仅粘贴；upload=仅上传（直接生成附件） */
  mode?: 'auto' | 'paste' | 'upload'
  /** 优先使用该选择器定位输入框；为空时自动定位可输入框 */
  targetSelector?: string
  /** 粘贴快捷键。auto=mac 用 Meta+V，其它用 Control+V；也可手动填如 Meta+V / Control+V / ControlOrMeta+V */
  pasteHotkey?: string
  /** 是否尝试 bringToFront + window.focus（默认 true） */
  ensurePageFocused?: boolean
  /** 校验失败时是否自动尝试 Meta/Control 的替代组合（默认 true） */
  fallbackOnNoEffect?: boolean
  waitAfterPaste?: number
  /** 可选：粘贴/上传后用于校验“附件已出现”的选择器（为空则使用内置默认规则） */
  attachIndicatorSelector?: string
  /** 是否校验附件是否出现（默认 true）。若校验失败会触发 uploadFallback（如开启） */
  verifyAttachment?: boolean
  /** 当剪贴板粘贴失败时，是否自动降级为文件上传（默认 true） */
  uploadFallback?: boolean
  /** 可选：点击该按钮打开上传器（如输入框左侧的 + 按钮） */
  openUploaderSelector?: string
  /** 可选：file input 选择器，不填则用 input[type=file] */
  fileInputSelector?: string
  /** 降级为文件上传后额外等待（ms） */
  waitAfterUpload?: number
  outputVar?: string
}

export interface ClickParams {
  useSelector?: boolean
  selector?: string
  text?: string     // 按文字找按钮（优先于 selector）
  elements?: Array<{  // [NEW] 支持多个候选元素，由上至下尝试，成功一个即返回
    text?: string
    selector?: string
    useSelector?: boolean
  }>
  nth?: number      // 第几个匹配（默认 last）
  waitFor?: boolean // 等待元素出现（默认 true）
  timeout?: number
}

export interface ScrollParams {
  // 滚动到指定元素（可选）
  selector?: string
  // 滚动固定像素（selector 优先）
  x?: number
  y?: number
  // 平滑滚动
  behavior?: 'auto' | 'smooth'
}

export interface FileUploadParams {
  selector: string  // input[type=file] 的选择器
  url: string       // 视频/文件 URL，支持 {{变量}}
}

export interface WaitConditionParams {
  // 检测目标（三选一）
  urlContains?: string           // URL 包含此字符串
  textMatch?: string             // 页面文字正则（用于提取进度数字）
  selector?: string              // 等待某元素出现 / 消失

  // 通过条件
  condition?:
    | 'value > {n}'              // 提取的数字 > n，例: "value > 90"
    | 'appeared'                 // 元素出现
    | 'disappeared'              // 元素消失
    | 'url_match'                // URL 匹配
    | string                     // 自定义（保留扩展）

  // 超时配置
  timeout?: number               // ms，默认 60000
  timeoutAction?: 'fail' | 'continue'  // 默认 'continue'

  pollInterval?: number          // 轮询间隔 ms，默认 2000

  // 额外的排除条件（配合 url_match 使用）
  excludeUrls?: string[]         // URL 不能包含这些字符串

  // textMatch 消失后：检查页面是否包含失败关键词
  failKeywords?: string[]        // 包含任一关键词则判定失败
  // textMatch 消失后：检查页面是否包含成功关键词（优先于 verifyButtonText）
  successKeywords?: string[]     // 包含任一关键词则判定成功
  // textMatch 消失后：验证某按钮可点击
  verifyButtonText?: string      // 按钮文字，找到且可点击则判定成功
}

export interface QRCodeParams {
  // 定位二维码图片
  selector?: string              // 二维码元素选择器（可选，默认自动检测）

  // 判断扫码成功
  successUrlContains: string     // 跳转后 URL 须包含此字符串
  excludeUrls?: string[]         // 同时不能包含这些（排除登录页）

  // Cookie 提取（扫码成功后）
  cookieDomain?: string          // 只提取该域名的 cookie；不填则提取所有

  // 刷新
  refreshInterval?: number       // 二维码自动刷新间隔 ms（默认 110000）

  // 超时
  timeout?: number               // 等待扫码超时 ms（默认 300000）
}

export interface ExtractImageClipboardParams {
  /** 触发复制的按钮选择器，默认为 Gemini "Copy image" 按钮 */
  copyButtonSelector?: string;
  /** 查找复制按钮超时（ms），默认 60000 */
  copyButtonTimeout?: number;
  /** 点击后等待剪贴板就绪时间（ms），默认 3000 */
  waitAfterCopy?: number;

  /**
   * 失败快判（减少无效等待）：当页面出现这些文本片段时直接判定失败。
   * 例如："抱歉，今天没办法帮你生成更多视频了"。
   */
  failFastTextIncludes?: string[];
  /** 失败快判：当页面出现这些 DOM（可见）时直接判定失败 */
  failFastSelector?: string;

  /** 是否上传到 OSS（默认 true） */
  uploadToOSS?: boolean;
  /** OSS 存储路径，支持 {{timestamp}} 模板 */
  ossPath?: string;
  /** 输出变量名（默认：imageUrl） */
  outputVar?: string;
}

export interface ExtractImageDownloadParams {
  downloadButtonSelector?: string;
  menuTriggerSelector?: string;
  menuItemSelector?: string;
  allowDomFallback?: boolean;
  allowClipboardFallback?: boolean;
  serializeClipboardAccess?: boolean;
  fallbackImageSelector?: string;
  buttonIndex?: number;
  buttonTimeout?: number;
  downloadTimeout?: number;
  maxRetries?: number;
  waitAfterClick?: number;
  minFileSizeBytes?: number;
  uploadToOSS?: boolean;
  ossPath?: string;
  outputVar?: string;

  /**
   * 失败快判（减少无效等待）：当页面出现这些文本片段时直接判定失败。
   * 例如："抱歉，今天没办法帮你生成更多视频了"。
   */
  failFastTextIncludes?: string[];
  /** 失败快判：当页面出现这些 DOM（可见）时直接判定失败 */
  failFastSelector?: string;

  /** 等待新按钮出现（多轮续话模式）：先记录当前按钮数量，等待数量增加后再下载最新按钮 */
  waitForNew?: boolean;
  /** waitForNew 模式的最大等待时间（ms），默认 120000 */
  waitForNewTimeout?: number;
}

export interface ExtractImageParams {
  selector?: string              // CSS 选择器（默认：页面第一个 img）
  index?: number                 // 如果匹配多个，取第几个（默认 0）
  uploadToOSS?: boolean          // 是否上传到 OSS（默认 true）
  ossPath?: string               // OSS 存储路径（默认：extract-images/{timestamp}.jpg）
  outputVar?: string             // 输出变量名（默认：imageUrl）
}

export interface XhsDownloadParams {
  noteUrl?: string               // 帖子直链（不填则在当前页操作）
  cardIndex?: number             // 在列表页时点第几张卡片（默认 0）
  maxImages?: number             // 最多下载张数（默认 20）
  ossPrefix?: string             // OSS 路径前缀（默认 'xhs'）
  outputVar?: string             // 输出变量名（默认 'xhsImages'）
}

export interface LocalhostImageDownloadParams {
  pageUrl?: string               // 解析页面URL（默认：http://localhost:1007/analysis/xhs）
  imageContainerSelector?: string // 图片容器选择器（默认：.rounded-xl.overflow-hidden.border）
  imageSelector?: string         // 图片选择器（默认：img）
  maxImages?: number             // 最大下载图片数量（默认：20）
  ossPrefix?: string             // OSS上传路径前缀（默认：xhs）
  outputVar?: string             // 输出变量名（默认：ossImageUrls）
  downloadTimeout?: number       // 单张图片下载超时时间（默认：10000ms）
  waitTime?: number              // 等待图片加载时间（默认：3000ms）
}

export interface LocalhostImageDownloadDebugParams {
  pageUrl?: string               // 解析页面URL
  imageContainerSelector?: string // 图片容器选择器
  imageSelector?: string         // 图片选择器
  maxImages?: number             // 最大检查图片数量
  outputVar?: string             // 输出变量名
}

export interface MetaAIGenerateParams {
  prompt: string                 // 提示词
  outputVar?: string             // 输出的 OSS 连接数组变量名，默认为 'metaaiVideos'
}

export interface MetaAIDownloadParams {
  outputVar?: string
  maxCount?: number
  waitForLoad?: number
  waitForNewButtons?: boolean
  newButtonTimeout?: number
  baselineVar?: string
  resetBaseline?: boolean
}

export interface CredentialLoginParams {
  platform?: 'douyin' | 'xhs' | 'gemini'
  credentialId?: string
  strict?: boolean
  outputCookieVar?: string
}

export interface WorkflowCallParams {
  workflowId: string
  runs?: Array<Record<string, string>> | string
  count?: number | string
  instanceIds?: string[] | string
  promptVarName?: string
  maxConcurrency?: number
  minSuccess?: number
  inheritVars?: boolean
  outputVar?: string
  outputDetailVar?: string
}

export interface GeminiParallelGenerateParams {
  prompts: string[]              // 待并发提交的提示词列表（建议 3 条）
  url?: string                   // Gemini 页面地址，默认 https://gemini.google.com/app
  inputSelector?: string         // 输入框选择器
  preClickText?: string          // 提交前先点击的按钮文案（如 Create image）
  preClickSelector?: string      // 提交前先点击的按钮选择器（优先于 preClickText）
  submitSelector?: string        // 提交按钮选择器，不填则按 Enter
  successSelector?: string       // 成功判定元素选择器（默认 Copy image 按钮）
  imageSelector?: string         // 可选：用于抓取图片 URL 的选择器
  uploadToOSS?: boolean          // 是否上传分支图片到 OSS（默认 true）
  ossPath?: string               // OSS 存储路径模板，支持 {{timestamp}}/{{index}}
  perTabTimeout?: number         // 每个 Tab 成功等待超时（ms）
  maxConcurrency?: number        // 并发度，默认 3
  minSuccess?: number            // 至少成功多少个分支才算节点成功
  closeExtraTabs?: boolean       // 是否关闭本节点创建的临时 Tab（默认 true）
  outputVar?: string             // 成功图片 URL 数组变量（JSON 字符串）
  outputDetailVar?: string       // 分支明细变量（JSON 字符串）
}

export interface VertexAIParams {
  capability: 'image_generate' | 'image_edit' | 'video_generate'
  prompt: string
  model: string
  count?: number
  aspectRatio?: string
  personGeneration?: string
  referenceImageUrls?: string
  sourceImageGcsUri?: string
  durationSeconds?: number
  generateAudio?: boolean
  uploadToOSS?: boolean
  ossPath?: string
  outputVar?: string
  outputListVar?: string
}

export interface TopicPickerAgentParams {
  goal?: string
  count?: number
  baseUrl?: string
  sources?: string[] | string
  perSourceLimit?: number
  evaluatorId?: string
  llmProvider?: 'auto' | 'openai' | 'gemini' | 'qianwen' | 'deepseek'
  llmModel?: string
  llmBaseUrl?: string
  llmApiKey?: string
  llmApiKeyEnv?: string
  llmTemperature?: number
  llmSystemPrompt?: string
  llmUserPromptTemplate?: string
  llmCandidateLimit?: number
  outputVar?: string
  outputDetailVar?: string
}

export interface AgentReactParams {
  systemPrompt?: string
  userPromptTemplate?: string
  llmProvider?: 'auto' | 'openai' | 'gemini' | 'qianwen' | 'deepseek'
  llmModel?: string
  llmBaseUrl?: string
  llmApiKey?: string
  llmApiKeyEnv?: string
  llmTemperature?: number
  tools?: string[] | string
  maxTurns?: number
  responseSchema?: string
  outputField?: string
  outputVar?: string
  outputDetailVar?: string
}

// ── 工作流定义 ────────────────────────────────────────────────────────────────

export interface WorkflowDef {
  id: string
  name: string
  description?: string
  vars: string[]          // 需要的变量名列表（如 ['videoUrl', 'title']）
  nodes: NodeDef[]
}

// ── 执行结果 ──────────────────────────────────────────────────────────────────

export interface NodeResult {
  success: boolean
  log: string[]
  screenshot?: string              // base64 data URL
  output?: Record<string, unknown> // 传递给后续节点的数据（如 cookies、进度值）
  error?: string
  newPage?: unknown                // 可选：用于工作流中途强制替换浏览器页面的游标引用
  newBrowser?: unknown             // 可选：用于存放伴随的新浏览器实例
}

export interface WorkflowContext {
  vars: Record<string, string>              // 输入变量（{{title}} 等）
  outputs: Record<string, unknown>          // 累积的节点输出
  emit?: (type: string, payload: string) => void  // SSE 推送（可选）
  humanOptions?: import('./human-options').HumanOptions  // 人工模拟开关
}

// ── Session（Debug 模式）─────────────────────────────────────────────────────

export interface StepHistory {
  stepIndex: number
  nodeType: NodeType
  label?: string
  result: NodeResult
  executedAt: number
}

export interface WorkflowSession {
  id: string
  workflowId: string
  workflow: WorkflowDef
  initialVars: Record<string, string>      // 会话创建时的初始变量，用于失败重试时回滚
  vars: Record<string, string>
  currentStep: number
  lastExecutedStep: number | null   // 最近一次实际执行的步骤索引（用于接力判断）
  status: 'paused' | 'running' | 'done' | 'error'
  history: StepHistory[]
  createdAt: number
  humanOptions: import('./human-options').HumanOptions
  // 运行时引用（不序列化）
  _page?: import('playwright').Page
  _browser?: import('playwright').Browser
  _idleSim?: import('./idle-simulator').IdleSimulator
}
