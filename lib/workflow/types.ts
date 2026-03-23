// ─────────────────────────────────────────────────────────────────────────────
//  Workflow Engine – Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

export type NodeType =
  | 'navigate'        // 基础：导航到 URL
  | 'text_input'      // 基础：文本填入
  | 'click'           // 基础：点击元素
  | 'scroll'          // 基础：滚动页面或滚动到元素
  | 'screenshot'      // 基础：截图快照
  | 'file_upload'     // 高级：URL → 下载 → 注入 <input type=file>
  | 'wait_condition'  // 高级：轮询 + 条件判断（值/URL/元素存在）
  | 'qrcode'          // 高级：截取二维码 → 等待扫码成功（URL 跳转判断）

// ── 节点定义 ──────────────────────────────────────────────────────────────────

export interface NodeDef {
  id?: string                        // 可选 ID，用于引用
  type: NodeType
  label?: string                     // 展示给用户的名称
  params: Record<string, unknown>    // 节点参数（支持 {{变量}} 模板）
  continueOnError?: boolean          // 失败时是否继续（默认 false）
}

// ── 节点参数类型（各节点 params 的具体定义）────────────────────────────────────

export interface NavigateParams {
  url: string
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'
  timeout?: number
}

export interface TextInputParams {
  selector: string
  value: string
  clear?: boolean   // 是否先清空（默认 true）
  delay?: number    // 每字符延迟 ms（模拟人工输入，默认 0）
}

export interface ClickParams {
  selector?: string
  text?: string     // 按文字找按钮（优先于 selector）
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
}

export interface WorkflowContext {
  vars: Record<string, string>              // 输入变量（{{title}} 等）
  outputs: Record<string, unknown>          // 累积的节点输出
  emit?: (type: string, payload: string) => void  // SSE 推送（可选）
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
  vars: Record<string, string>
  currentStep: number
  status: 'paused' | 'running' | 'done' | 'error'
  history: StepHistory[]
  createdAt: number
  // Playwright page 引用（运行时，不序列化）
  _page?: import('playwright').Page
}
