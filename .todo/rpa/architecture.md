# 🏗️ RPA 引擎技术架构方案

> 版本: v1.0.0  
> 作者: Copilot  
> 日期: 2026-03-23

---

## 1. 设计目标

| 目标 | 说明 |
|------|------|
| **可配置** | 平台选择器、流程步骤通过配置定义，无需改代码 |
| **可复用** | 登录、上传、填表等通用行为抽象为节点，跨平台复用 |
| **可扩展** | 新增平台只需添加配置文件 |
| **可观测** | 每步执行状态实时上报，支持截图记录 |
| **容错性** | 选择器降级、自动重试、超时处理 |

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              RPA 系统架构                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐    ┌─────────────────────────────────────────────────┐│
│  │  前端 UI    │    │              Workflow 配置层                    ││
│  │  /publish   │    │  ┌─────────┐ ┌─────────┐ ┌─────────┐           ││
│  │  /rpa       │    │  │ 抖音    │ │ 微信    │ │ 小红书  │  ...      ││
│  └──────┬──────┘    │  │ 发布流程│ │ 发布流程│ │ 发布流程│           ││
│         │           │  └────┬────┘ └────┬────┘ └────┬────┘           ││
│         │           └───────┼───────────┼───────────┼─────────────────┘│
│         │                   │           │           │                  │
│         ▼                   ▼           ▼           ▼                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      RPA Engine (核心引擎)                        │  │
│  │  ┌──────────────────────────────────────────────────────────┐   │  │
│  │  │                    Step Executor                          │   │  │
│  │  │  navigate │ click │ type │ upload │ captureQR │ ...      │   │  │
│  │  └──────────────────────────────────────────────────────────┘   │  │
│  │  ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐   │  │
│  │  │ Variable Resolver│  │ Selector Fallback│  │ Retry Handler │   │  │
│  │  └────────────────┘  └────────────────┘  └─────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│                                    ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      Playwright Driver                            │  │
│  │         BrowserContext │ Page │ Locator │ Screenshot             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│                                    ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      持久化存储层                                 │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │  │
│  │  │ Browser Data │  │  Cookie/凭证 │  │ Supabase (Workflow) │   │  │
│  │  │ (本地指纹)   │  │  (本地/云端) │  │ (配置同步)          │   │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 核心类型定义

### 3.1 工作流配置 (Workflow)

```typescript
interface Workflow {
  id: string;                          // 唯一标识
  name: string;                        // 显示名称
  platform: Platform;                  // 目标平台
  version: string;                     // 版本号
  description?: string;                // 描述
  
  // 变量定义（可被运行时覆盖）
  variables: Record<string, string>;
  
  // 步骤列表
  steps: ActionStep[];
  
  // 元数据
  createdAt?: string;
  updatedAt?: string;
}

type Platform = 'douyin' | 'wechat' | 'xiaohongshu' | 'bilibili' | 'kuaishou';
```

### 3.2 动作步骤 (ActionStep)

```typescript
interface ActionStep {
  id: string;                          // 步骤 ID
  name?: string;                       // 步骤名称（日志显示）
  type: ActionType;                    // 动作类型
  params: ActionParams;                // 动作参数
  
  // 流程控制
  onSuccess?: string;                  // 成功后跳转的步骤 ID
  onFail?: string;                     // 失败后跳转的步骤 ID
  
  // 重试配置
  retry?: {
    times: number;                     // 重试次数
    delayMs: number;                   // 重试间隔
  };
  
  // 超时配置
  timeout?: number;                    // 毫秒
  
  // 条件执行
  when?: ConditionExpr;                // 满足条件才执行
}
```

### 3.3 动作类型 (ActionType)

```typescript
type ActionType =
  // 页面操作
  | 'navigate'           // 导航到 URL
  | 'reload'             // 刷新页面
  | 'goBack'             // 后退
  
  // 元素交互
  | 'click'              // 点击
  | 'dblclick'           // 双击
  | 'type'               // 输入文本
  | 'clear'              // 清空输入框
  | 'select'             // 下拉选择
  | 'check'              // 勾选复选框
  | 'upload'             // 上传文件
  | 'hover'              // 悬停
  | 'scroll'             // 滚动
  
  // 等待
  | 'waitFor'            // 等待元素出现
  | 'waitForHidden'      // 等待元素消失
  | 'waitForUrl'         // 等待 URL 变化
  | 'waitForNetwork'     // 等待网络空闲
  | 'sleep'              // 固定等待
  
  // 登录相关
  | 'captureQR'          // 截取二维码
  | 'waitForLogin'       // 等待扫码登录完成
  | 'extractCookie'      // 提取 Cookie
  | 'injectCookie'       // 注入 Cookie
  
  // 数据提取
  | 'extractText'        // 提取文本到变量
  | 'extractAttr'        // 提取属性到变量
  | 'screenshot'         // 截图
  
  // 流程控制
  | 'condition'          // 条件分支
  | 'loop'               // 循环等待条件成立
  | 'forEach'            // 遍历数组
  | 'break'              // 跳出循环
  | 'goto'               // 跳转到指定步骤
  
  // 事件
  | 'emit'               // 发送事件到前端
  | 'log'                // 记录日志
  
  // 系统
  | 'setVariable'        // 设置变量
  | 'assert'             // 断言（失败则终止）
  | 'runWorkflow';       // 调用子工作流
```

### 3.4 动作参数 (ActionParams)

```typescript
interface ActionParams {
  // 选择器（支持单个或数组降级）
  selector?: string | string[];
  
  // URL
  url?: string;
  urlPattern?: string;              // 用于 waitForUrl
  excludePatterns?: string[];       // URL 排除模式
  
  // 输入值
  value?: string;
  
  // 文件路径（upload 用）
  filePath?: string;
  
  // 超时
  timeout?: number;
  
  // 条件表达式
  condition?: ConditionExpr;
  
  // 循环配置
  interval?: number;                // loop 检查间隔
  maxIterations?: number;           // 最大迭代次数
  
  // 事件配置
  event?: string;                   // emit 事件名
  message?: string;                 // emit 消息
  
  // Cookie 配置
  domain?: string;
  cookieNames?: string[];           // 要提取的 cookie 名
  
  // 变量配置
  variableName?: string;            // 存储结果的变量名
  attribute?: string;               // extractAttr 用
  
  // 子工作流
  workflowId?: string;
  workflowParams?: Record<string, string>;
}
```

### 3.5 条件表达式 (ConditionExpr)

```typescript
interface ConditionExpr {
  // 元素条件
  selector?: string;
  state?: 'visible' | 'hidden' | 'attached' | 'detached';
  
  // 文本条件
  textContains?: string;
  textEquals?: string;
  textMatches?: string;             // 正则
  
  // URL 条件
  urlContains?: string;
  urlMatches?: string;
  
  // 变量条件
  variable?: string;
  equals?: string;
  notEquals?: string;
  contains?: string;
  
  // 逻辑组合
  and?: ConditionExpr[];
  or?: ConditionExpr[];
  not?: ConditionExpr;
}
```

---

## 4. 核心模块设计

### 4.1 RPAEngine（执行引擎）

```typescript
class RPAEngine {
  private page: Page;
  private workflow: Workflow;
  private variables: Map<string, string>;
  private emit: EmitFn;
  private executionLog: ExecutionLog[];
  
  // 公开方法
  constructor(page: Page, workflow: Workflow, emit: EmitFn);
  setVariable(key: string, value: string): void;
  setVariables(vars: Record<string, string>): void;
  async run(): Promise<ExecutionResult>;
  abort(): void;
  
  // 内部方法
  private resolve(template: string): string;
  private resolveSelector(selectors: string | string[]): Promise<string | null>;
  private evaluateCondition(cond: ConditionExpr): Promise<boolean>;
  private executeStep(step: ActionStep): Promise<StepResult>;
}

interface ExecutionResult {
  success: boolean;
  stepsExecuted: number;
  duration: number;
  error?: string;
  variables: Record<string, string>;
}

interface StepResult {
  status: 'success' | 'fail' | 'skip';
  nextStepId?: string;
  error?: string;
}
```

### 4.2 StepExecutors（步骤执行器）

```typescript
// 每种 ActionType 对应一个执行器
interface StepExecutor {
  execute(page: Page, params: ActionParams, context: ExecutionContext): Promise<void>;
}

// 执行器注册表
const executors: Record<ActionType, StepExecutor> = {
  navigate: new NavigateExecutor(),
  click: new ClickExecutor(),
  type: new TypeExecutor(),
  upload: new UploadExecutor(),
  captureQR: new CaptureQRExecutor(),
  waitForLogin: new WaitForLoginExecutor(),
  // ...
};
```

### 4.3 SelectorResolver（选择器解析器）

```typescript
class SelectorResolver {
  private page: Page;
  
  /**
   * 解析选择器，支持多路降级
   * @param selectors 单个选择器或选择器数组
   * @returns 第一个可见的选择器，或 null
   */
  async resolve(selectors: string | string[]): Promise<string | null>;
  
  /**
   * 智能选择器：先尝试精确匹配，失败则模糊匹配
   */
  async smartResolve(hints: SelectorHints): Promise<string | null>;
}

interface SelectorHints {
  id?: string;
  className?: string;
  text?: string;
  placeholder?: string;
  role?: string;
  testId?: string;
}
```

---

## 5. 工作流配置示例

### 5.1 抖音发布工作流

```json
{
  "id": "douyin-publish",
  "name": "抖音视频发布",
  "platform": "douyin",
  "version": "1.0.0",
  "variables": {
    "uploadUrl": "https://creator.douyin.com/creator-micro/content/upload",
    "uploadSelector": "input[accept*=\"video/mp4\"]",
    "titleSelector": "[class*=\"title\"] input, [placeholder*=\"标题\"], .editor-kit-editor-container",
    "publishBtn": "button:has-text(\"发布\")",
    "qrSelectors": "[class*=\"qrcode_img\"], [class*=\"scan_qrcode\"], canvas[class*=\"qr\"]"
  },
  "steps": [
    {
      "id": "start",
      "name": "打开发布页",
      "type": "navigate",
      "params": { "url": "${uploadUrl}" },
      "timeout": 30000,
      "onSuccess": "checkLogin"
    },
    {
      "id": "checkLogin",
      "name": "检测登录状态",
      "type": "condition",
      "params": {
        "condition": {
          "selector": "${uploadSelector}",
          "state": "visible"
        }
      },
      "timeout": 10000,
      "onSuccess": "upload",
      "onFail": "showQR"
    },
    {
      "id": "showQR",
      "name": "截取登录二维码",
      "type": "captureQR",
      "params": { "selector": "${qrSelectors}" },
      "onSuccess": "waitLogin"
    },
    {
      "id": "waitLogin",
      "name": "等待扫码登录",
      "type": "waitForLogin",
      "params": {
        "urlPattern": "creator-micro",
        "excludePatterns": ["/login", "qrcode", "passport"],
        "timeout": 300000
      },
      "onSuccess": "saveCookie",
      "onFail": "loginTimeout"
    },
    {
      "id": "saveCookie",
      "name": "保存登录凭证",
      "type": "extractCookie",
      "params": { "domain": "douyin.com" },
      "onSuccess": "upload"
    },
    {
      "id": "upload",
      "name": "上传视频文件",
      "type": "upload",
      "params": {
        "selector": "${uploadSelector}",
        "filePath": "${videoPath}"
      },
      "retry": { "times": 2, "delayMs": 3000 },
      "onSuccess": "waitUpload"
    },
    {
      "id": "waitUpload",
      "name": "等待上传完成",
      "type": "waitFor",
      "params": {
        "selector": "[class*=\"progress\"]:has-text(\"100%\"), :text(\"上传成功\")",
        "timeout": 180000
      },
      "onSuccess": "fillTitle"
    },
    {
      "id": "fillTitle",
      "name": "填写标题",
      "type": "type",
      "params": {
        "selector": "${titleSelector}",
        "value": "${title}"
      },
      "onSuccess": "fillDescription"
    },
    {
      "id": "fillDescription",
      "name": "填写描述",
      "type": "type",
      "params": {
        "selector": ".editor-kit-editor-container",
        "value": "${description}"
      },
      "when": { "variable": "description", "notEquals": "" },
      "onSuccess": "waitDetection"
    },
    {
      "id": "waitDetection",
      "name": "等待视频检测",
      "type": "loop",
      "params": {
        "condition": {
          "or": [
            { "selector": ":text(\"检测通过\")", "state": "visible" },
            { "selector": ":text(\"可以发布\")", "state": "visible" }
          ]
        },
        "interval": 3000,
        "timeout": 120000
      },
      "onSuccess": "clickPublish",
      "onFail": "detectionFailed"
    },
    {
      "id": "clickPublish",
      "name": "点击发布按钮",
      "type": "click",
      "params": { "selector": "${publishBtn}" },
      "onSuccess": "waitPublishResult"
    },
    {
      "id": "waitPublishResult",
      "name": "等待发布结果",
      "type": "waitFor",
      "params": {
        "selector": ":text(\"发布成功\"), :text(\"已发布\")",
        "timeout": 30000
      },
      "onSuccess": "done",
      "onFail": "publishFailed"
    },
    {
      "id": "done",
      "type": "emit",
      "params": { "event": "done", "message": "🎉 视频发布成功！" }
    },
    {
      "id": "loginTimeout",
      "type": "emit",
      "params": { "event": "error", "message": "登录超时，请重试" }
    },
    {
      "id": "detectionFailed",
      "type": "emit",
      "params": { "event": "error", "message": "视频检测未通过" }
    },
    {
      "id": "publishFailed",
      "type": "emit",
      "params": { "event": "error", "message": "发布失败，请检查内容" }
    }
  ]
}
```

---

## 6. 数据存储设计

### 6.1 Supabase 表结构

```sql
-- 工作流配置表
CREATE TABLE rpa_workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  variables JSONB DEFAULT '{}',
  steps JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 工作流版本历史
CREATE TABLE rpa_workflow_versions (
  id SERIAL PRIMARY KEY,
  workflow_id TEXT REFERENCES rpa_workflows(id),
  version TEXT NOT NULL,
  steps JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(workflow_id, version)
);

-- 执行记录
CREATE TABLE rpa_executions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT REFERENCES rpa_workflows(id),
  client_id TEXT,
  status TEXT NOT NULL, -- pending, running, success, failed, cancelled
  variables JSONB,
  steps_executed INTEGER DEFAULT 0,
  duration_ms INTEGER,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- 步骤执行日志
CREATE TABLE rpa_step_logs (
  id SERIAL PRIMARY KEY,
  execution_id TEXT REFERENCES rpa_executions(id),
  step_id TEXT NOT NULL,
  status TEXT NOT NULL, -- success, fail, skip
  screenshot_url TEXT,
  error TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 7. API 设计

### 7.1 工作流管理

```
GET    /api/rpa/workflows                 # 列出所有工作流
GET    /api/rpa/workflows/:id             # 获取单个工作流
POST   /api/rpa/workflows                 # 创建工作流
PUT    /api/rpa/workflows/:id             # 更新工作流
DELETE /api/rpa/workflows/:id             # 删除工作流
POST   /api/rpa/workflows/:id/duplicate   # 复制工作流
```

### 7.2 工作流执行

```
POST   /api/rpa/execute                   # 执行工作流（SSE 流式）
GET    /api/rpa/executions                # 执行历史
GET    /api/rpa/executions/:id            # 执行详情
POST   /api/rpa/executions/:id/cancel     # 取消执行
```

### 7.3 调试

```
POST   /api/rpa/debug/step                # 单步执行
POST   /api/rpa/debug/selector            # 测试选择器
```

---

## 8. 前端页面规划

### 8.1 页面结构

```
/publish                    # 现有发布页（入口）
/publish?tab=rpa           # RPA 工作台标签页

/rpa                       # RPA 管理首页
/rpa/workflows             # 工作流列表
/rpa/workflows/:id         # 工作流详情/编辑
/rpa/workflows/:id/test    # 工作流测试
/rpa/executions            # 执行历史
/rpa/executions/:id        # 执行详情（步骤日志+截图）
```

### 8.2 /publish 页面菜单扩展

```
┌────────────────────────────────────────────────────────────┐
│  视频发布                                                  │
├────────────────────────────────────────────────────────────┤
│  [抖音发布] [微信公众号] [小红书] [B站] │ [⚙️ RPA工作台]   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  选择发布平台后，显示对应的表单                             │
│  点击 RPA 工作台，跳转到 /rpa                              │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 9. 开发路线图

### Phase 1: 核心引擎（1-2 周）
1. 实现类型系统 `lib/rpa/types.ts`
2. 实现执行引擎 `lib/rpa/engine.ts`
3. 实现基础步骤执行器（navigate, click, type, upload, waitFor）
4. 单元测试

### Phase 2: 登录相关（3-5 天）
5. 实现 captureQR, waitForLogin, extractCookie
6. 与现有登录流程集成
7. 测试抖音扫码登录

### Phase 3: 配置化（3-5 天）
8. 抽取现有 douyin-publish.ts 为工作流配置
9. Supabase 表结构 + CRUD API
10. 验证配置等价于硬编码逻辑

### Phase 4: 前端集成（1 周）
11. /publish 页面添加平台 Tab
12. /rpa 页面搭建
13. 工作流可视化编辑器（基础版）

### Phase 5: 多平台扩展（按需）
14. 微信公众号工作流配置
15. 小红书工作流配置
16. ...

---

## 10. 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| 平台选择器频繁变化 | 工作流失效 | 选择器多路降级 + 监控告警 |
| 执行超时 | 任务失败 | 合理超时设置 + 重试机制 |
| 反爬策略升级 | 登录/操作失败 | 持久化浏览器指纹 + 人工介入 |
| 配置复杂度 | 维护成本高 | 可视化编辑器 + 模板库 |

---

## 附录：文件结构规划

```
lib/rpa/
├── types.ts              # 类型定义
├── engine.ts             # 执行引擎
├── selector-resolver.ts  # 选择器解析
├── variable-resolver.ts  # 变量解析
├── condition-evaluator.ts# 条件求值
├── executors/            # 步骤执行器
│   ├── index.ts
│   ├── navigate.ts
│   ├── click.ts
│   ├── type.ts
│   ├── upload.ts
│   ├── capture-qr.ts
│   ├── wait-for-login.ts
│   ├── extract-cookie.ts
│   ├── condition.ts
│   ├── loop.ts
│   └── emit.ts
├── workflows/            # 内置工作流配置
│   ├── douyin-publish.json
│   ├── wechat-publish.json
│   └── xiaohongshu-publish.json
└── __tests__/            # 测试
    ├── engine.test.ts
    └── executors.test.ts

app/api/rpa/
├── workflows/
│   └── route.ts          # CRUD
├── execute/
│   └── route.ts          # SSE 执行
└── debug/
    └── route.ts          # 调试接口

app/rpa/
├── page.tsx              # RPA 首页
├── workflows/
│   ├── page.tsx          # 列表
│   └── [id]/
│       └── page.tsx      # 详情/编辑
└── executions/
    ├── page.tsx          # 历史
    └── [id]/
        └── page.tsx      # 详情
```
