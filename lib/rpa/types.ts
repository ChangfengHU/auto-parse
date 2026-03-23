/**
 * RPA 引擎类型定义
 * 
 * 核心概念：
 * - Workflow: 工作流配置，包含一系列步骤
 * - ActionStep: 单个操作步骤
 * - ActionType: 操作类型（click, type, upload 等）
 * - ActionParams: 操作参数
 */

// ═══════════════════════════════════════════════════════════════════════════
// 平台类型
// ═══════════════════════════════════════════════════════════════════════════

export type Platform = 
  | 'douyin' 
  | 'wechat' 
  | 'xiaohongshu' 
  | 'bilibili' 
  | 'kuaishou'
  | 'tiktok'
  | 'custom';

// ═══════════════════════════════════════════════════════════════════════════
// 工作流配置
// ═══════════════════════════════════════════════════════════════════════════

export interface Workflow {
  /** 唯一标识 */
  id: string;
  
  /** 显示名称 */
  name: string;
  
  /** 目标平台 */
  platform: Platform;
  
  /** 版本号 */
  version: string;
  
  /** 描述 */
  description?: string;
  
  /** 变量定义（可被运行时覆盖） */
  variables: Record<string, string>;
  
  /** 步骤列表 */
  steps: ActionStep[];
  
  /** 是否启用 */
  isActive?: boolean;
  
  /** 创建时间 */
  createdAt?: string;
  
  /** 更新时间 */
  updatedAt?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 动作步骤
// ═══════════════════════════════════════════════════════════════════════════

export interface ActionStep {
  /** 步骤 ID（用于流程跳转） */
  id: string;
  
  /** 步骤名称（日志显示用） */
  name?: string;
  
  /** 动作类型 */
  type: ActionType;
  
  /** 动作参数 */
  params: ActionParams;
  
  /** 成功后跳转的步骤 ID（不指定则顺序执行下一步） */
  onSuccess?: string;
  
  /** 失败后跳转的步骤 ID（不指定则终止工作流） */
  onFail?: string;
  
  /** 重试配置 */
  retry?: RetryConfig;
  
  /** 超时时间（毫秒） */
  timeout?: number;
  
  /** 条件执行：满足条件才执行此步骤 */
  when?: ConditionExpr;
  
  /** 是否跳过此步骤（调试用） */
  skip?: boolean;
}

export interface RetryConfig {
  /** 重试次数 */
  times: number;
  
  /** 重试间隔（毫秒） */
  delayMs: number;
  
  /** 指数退避 */
  exponential?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// 动作类型
// ═══════════════════════════════════════════════════════════════════════════

export type ActionType =
  // ─── 页面导航 ───
  | 'navigate'           // 导航到 URL
  | 'reload'             // 刷新页面
  | 'goBack'             // 后退
  | 'goForward'          // 前进
  
  // ─── 元素交互 ───
  | 'click'              // 点击
  | 'dblclick'           // 双击
  | 'rightClick'         // 右键点击
  | 'type'               // 输入文本
  | 'fill'               // 填充输入框（先清空）
  | 'clear'              // 清空输入框
  | 'press'              // 按键
  | 'select'             // 下拉选择
  | 'check'              // 勾选复选框
  | 'uncheck'            // 取消勾选
  | 'upload'             // 上传文件
  | 'hover'              // 悬停
  | 'focus'              // 聚焦
  | 'blur'               // 失焦
  | 'scroll'             // 滚动
  | 'scrollIntoView'     // 滚动元素到可见
  
  // ─── 等待 ───
  | 'waitFor'            // 等待元素出现
  | 'waitForHidden'      // 等待元素消失
  | 'waitForEnabled'     // 等待元素可用
  | 'waitForUrl'         // 等待 URL 变化
  | 'waitForNetwork'     // 等待网络空闲
  | 'waitForResponse'    // 等待特定响应
  | 'sleep'              // 固定等待
  
  // ─── 登录相关 ───
  | 'captureQR'          // 截取二维码
  | 'waitForLogin'       // 等待扫码登录完成
  | 'extractCookie'      // 提取 Cookie
  | 'injectCookie'       // 注入 Cookie
  | 'checkLogin'         // 检查登录状态
  
  // ─── 数据提取 ───
  | 'extractText'        // 提取文本到变量
  | 'extractAttr'        // 提取属性到变量
  | 'extractHtml'        // 提取 HTML 到变量
  | 'extractValue'       // 提取输入框值到变量
  | 'extractUrl'         // 提取当前 URL 到变量
  | 'screenshot'         // 截图
  | 'screenshotElement'  // 元素截图
  
  // ─── 流程控制 ───
  | 'condition'          // 条件分支
  | 'loop'               // 循环等待条件成立
  | 'forEach'            // 遍历数组
  | 'while'              // while 循环
  | 'break'              // 跳出循环
  | 'continue'           // 继续下一次循环
  | 'goto'               // 跳转到指定步骤
  | 'exit'               // 退出工作流
  
  // ─── 事件与日志 ───
  | 'emit'               // 发送事件到前端
  | 'log'                // 记录日志
  | 'debug'              // 调试输出
  
  // ─── 变量操作 ───
  | 'setVariable'        // 设置变量
  | 'deleteVariable'     // 删除变量
  | 'incrementVariable'  // 变量自增
  | 'appendVariable'     // 追加到变量（数组或字符串）
  
  // ─── 断言 ───
  | 'assert'             // 断言（失败则终止）
  | 'assertText'         // 断言文本
  | 'assertVisible'      // 断言元素可见
  | 'assertUrl'          // 断言 URL
  
  // ─── 子流程 ───
  | 'runWorkflow'        // 调用子工作流
  | 'parallel'           // 并行执行多个步骤
  
  // ─── 浏览器操作 ───
  | 'newPage'            // 新建标签页
  | 'closePage'          // 关闭标签页
  | 'switchPage'         // 切换标签页
  | 'setViewport'        // 设置视口大小
  
  // ─── 对话框处理 ───
  | 'acceptDialog'       // 接受对话框
  | 'dismissDialog'      // 取消对话框
  | 'handleDialog';      // 处理对话框

// ═══════════════════════════════════════════════════════════════════════════
// 动作参数
// ═══════════════════════════════════════════════════════════════════════════

export interface ActionParams {
  // ─── 选择器 ───
  /** 元素选择器（支持单个或数组降级） */
  selector?: string | string[];
  
  /** 选择器类型 */
  selectorType?: 'css' | 'xpath' | 'text' | 'role' | 'testId';
  
  // ─── URL ───
  /** 目标 URL */
  url?: string;
  
  /** URL 匹配模式（用于 waitForUrl） */
  urlPattern?: string;
  
  /** URL 排除模式 */
  excludePatterns?: string[];
  
  // ─── 输入值 ───
  /** 输入值 */
  value?: string;
  
  /** 按键（用于 press） */
  key?: string;
  
  /** 按键修饰符 */
  modifiers?: ('Alt' | 'Control' | 'Meta' | 'Shift')[];
  
  // ─── 文件 ───
  /** 文件路径（upload 用） */
  filePath?: string;
  
  /** 文件路径数组（多文件上传） */
  filePaths?: string[];
  
  // ─── 超时 ───
  /** 超时时间（毫秒） */
  timeout?: number;
  
  // ─── 条件 ───
  /** 条件表达式 */
  condition?: ConditionExpr;
  
  // ─── 循环 ───
  /** 循环检查间隔（毫秒） */
  interval?: number;
  
  /** 最大迭代次数 */
  maxIterations?: number;
  
  /** 遍历的数组变量名 */
  arrayVariable?: string;
  
  /** 当前元素变量名 */
  itemVariable?: string;
  
  /** 当前索引变量名 */
  indexVariable?: string;
  
  // ─── 事件 ───
  /** 事件名称 */
  event?: 'log' | 'qrcode' | 'done' | 'error' | 'progress' | string;
  
  /** 事件消息 */
  message?: string;
  
  /** 事件数据 */
  data?: Record<string, unknown>;
  
  // ─── Cookie ───
  /** Cookie 域名 */
  domain?: string;
  
  /** 要提取的 cookie 名 */
  cookieNames?: string[];
  
  /** Cookie 字符串（注入用） */
  cookieStr?: string;
  
  // ─── 变量 ───
  /** 变量名（存储结果用） */
  variableName?: string;
  
  /** 变量值 */
  variableValue?: string;
  
  /** 属性名（extractAttr 用） */
  attribute?: string;
  
  // ─── 截图 ───
  /** 截图保存路径 */
  screenshotPath?: string;
  
  /** 是否全页截图 */
  fullPage?: boolean;
  
  // ─── 滚动 ───
  /** 滚动方向 */
  direction?: 'up' | 'down' | 'left' | 'right';
  
  /** 滚动距离（像素） */
  distance?: number;
  
  // ─── 子工作流 ───
  /** 子工作流 ID */
  workflowId?: string;
  
  /** 子工作流参数 */
  workflowParams?: Record<string, string>;
  
  // ─── 并行执行 ───
  /** 并行步骤 */
  parallelSteps?: ActionStep[];
  
  // ─── 对话框 ───
  /** 对话框输入文本 */
  promptText?: string;
  
  // ─── 视口 ───
  /** 视口宽度 */
  width?: number;
  
  /** 视口高度 */
  height?: number;
  
  // ─── 断言 ───
  /** 预期值 */
  expected?: string;
  
  /** 断言消息 */
  assertMessage?: string;
  
  // ─── URL 条件 ───
  /** URL 包含 */
  urlContains?: string;
  
  // ─── 字符串操作 ───
  /** 分隔符 */
  delimiter?: string;
  
  // ─── 日志 ───
  /** 日志级别 */
  level?: 'debug' | 'info' | 'warn' | 'error';
  
  // ─── 网络 ───
  /** 响应 URL 模式（waitForResponse 用） */
  responseUrlPattern?: string;
  
  // ─── 点击选项 ───
  /** 点击次数 */
  clickCount?: number;
  
  /** 点击延迟 */
  delay?: number;
  
  /** 点击位置 */
  position?: { x: number; y: number };
  
  /** 强制点击（即使元素被遮挡） */
  force?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// 条件表达式
// ═══════════════════════════════════════════════════════════════════════════

export interface ConditionExpr {
  // ─── 元素条件 ───
  /** 元素选择器 */
  selector?: string;
  
  /** 元素状态 */
  state?: 'visible' | 'hidden' | 'attached' | 'detached' | 'enabled' | 'disabled';
  
  // ─── 文本条件 ───
  /** 文本包含 */
  textContains?: string;
  
  /** 文本等于 */
  textEquals?: string;
  
  /** 文本匹配（正则） */
  textMatches?: string;
  
  // ─── URL 条件 ───
  /** URL 包含 */
  urlContains?: string;
  
  /** URL 匹配（正则） */
  urlMatches?: string;
  
  /** URL 等于 */
  urlEquals?: string;
  
  // ─── 变量条件 ───
  /** 变量名 */
  variable?: string;
  
  /** 等于 */
  equals?: string;
  
  /** 不等于 */
  notEquals?: string;
  
  /** 包含 */
  contains?: string;
  
  /** 匹配（正则） */
  matches?: string;
  
  /** 大于 */
  greaterThan?: number;
  
  /** 小于 */
  lessThan?: number;
  
  /** 存在（非空） */
  exists?: boolean;
  
  /** 为空 */
  isEmpty?: boolean;
  
  // ─── 逻辑组合 ───
  /** 与（所有条件都满足） */
  and?: ConditionExpr[];
  
  /** 或（任一条件满足） */
  or?: ConditionExpr[];
  
  /** 非 */
  not?: ConditionExpr;
}

// ═══════════════════════════════════════════════════════════════════════════
// 执行结果
// ═══════════════════════════════════════════════════════════════════════════

export interface ExecutionResult {
  /** 是否成功 */
  success: boolean;
  
  /** 执行的步骤数 */
  stepsExecuted: number;
  
  /** 执行时长（毫秒） */
  duration: number;
  
  /** 错误信息 */
  error?: string;
  
  /** 最终变量状态 */
  variables: Record<string, string>;
  
  /** 执行 ID */
  executionId?: string;
  
  /** 步骤日志 */
  stepLogs?: StepLog[];
}

export interface StepLog {
  /** 步骤 ID */
  stepId: string;
  
  /** 步骤名称 */
  stepName?: string;
  
  /** 执行状态 */
  status: 'success' | 'fail' | 'skip';
  
  /** 错误信息 */
  error?: string;
  
  /** 截图 URL */
  screenshotUrl?: string;
  
  /** 执行时长（毫秒） */
  duration: number;
  
  /** 时间戳 */
  timestamp: string;
}

export interface StepResult {
  /** 执行状态 */
  status: 'success' | 'fail' | 'skip';
  
  /** 下一步 ID */
  nextStepId?: string;
  
  /** 错误信息 */
  error?: string;
  
  /** 截图 URL */
  screenshotUrl?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 执行上下文
// ═══════════════════════════════════════════════════════════════════════════

export interface ExecutionContext {
  /** 变量存储 */
  variables: Map<string, string>;
  
  /** 获取解析后的值（支持 ${var} 语法） */
  resolve: (template: string) => string;
  
  /** 发送事件 */
  emit: EmitFn;
  
  /** 记录日志 */
  log: (message: string) => void;
  
  /** 截图 */
  screenshot: (name: string) => Promise<string | null>;
  
  /** 循环状态（用于 break/continue） */
  loopState?: {
    shouldBreak: boolean;
    shouldContinue: boolean;
  };
}

export type EmitFn = (type: string, payload: string) => void;

// ═══════════════════════════════════════════════════════════════════════════
// 执行器接口
// ═══════════════════════════════════════════════════════════════════════════

export interface StepExecutor {
  /** 执行步骤 */
  execute(
    page: import('playwright').Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════════
// 引擎配置
// ═══════════════════════════════════════════════════════════════════════════

export interface RPAEngineConfig {
  /** 默认超时时间（毫秒） */
  defaultTimeout?: number;
  
  /** 默认重试次数 */
  defaultRetryTimes?: number;
  
  /** 默认重试间隔（毫秒） */
  defaultRetryDelay?: number;
  
  /** 是否在每步后截图 */
  screenshotOnStep?: boolean;
  
  /** 是否在失败时截图 */
  screenshotOnError?: boolean;
  
  /** 调试模式 */
  debug?: boolean;
  
  /** 步骤执行前回调 */
  onBeforeStep?: (step: ActionStep) => Promise<void>;
  
  /** 步骤执行后回调 */
  onAfterStep?: (step: ActionStep, result: StepResult) => Promise<void>;
}
