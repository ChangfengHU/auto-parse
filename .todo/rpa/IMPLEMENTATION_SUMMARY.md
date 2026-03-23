# 工作流管理系统 - 实现总结

## 已完成功能

### ✅ 核心功能

1. **工作流管理页面** (`/workflows`)
   - 左侧步骤列表显示抖音发布流程的 10 个步骤
   - 右侧浏览器实时预览（通过 SSE 流推送截图，1 FPS）
   - 点击步骤可查看详情（选择器、参数等）
   - 点击"▶ 执行"按钮立即执行该步骤

2. **浏览器控制 API**
   - `GET /api/workflow/browser?action=screenshot` - SSE 截图流
   - `POST /api/workflow/browser` - 执行步骤或启用元素选择器
   - `GET /api/workflow/picked-element` - 获取已选元素信息

3. **元素选择器捕获**
   - 点击"🎯 选择元素"激活选择模式
   - 浏览器页面注入点击监听脚本
   - 点击元素自动生成 CSS 选择器和 XPath
   - 高亮显示选中元素 2 秒
   - 点击"✓ 应用选择器"更新步骤配置

4. **工作流配置导出**
   - 点击"💾 导出配置"下载 JSON 文件
   - 包含完整的步骤定义、选择器、参数

5. **左侧导航菜单**
   - 新增"工作流管理"菜单项
   - 与"视频发布"、"素材库"等并列

### 📁 文件结构

```
app/
├── workflows/
│   └── page.tsx                          # 工作流管理主页面
├── api/
│   └── workflow/
│       ├── browser/
│       │   └── route.ts                  # 浏览器控制 API (SSE + 执行步骤)
│       └── picked-element/
│           └── route.ts                  # 获取已选元素 API

components/
├── workflow-editor.tsx                   # 工作流编辑器（SSE 版本）
├── workflow-visualizer.tsx               # 工作流可视化展示
└── Sidebar.tsx                           # 左侧导航栏（已添加工作流管理）

docs/
└── WORKFLOW_MANAGEMENT.md                # 工作流管理系统文档
```

## 技术实现

### 1. 浏览器实时预览
使用 **SSE (Server-Sent Events)** 代替 WebSocket：
- 每秒截图一次持久化浏览器实例
- 将截图转换为 base64 JPEG 格式
- 通过 SSE 流推送到前端
- 前端用 `<img>` 标签显示

**为什么不用 WebSocket？**
- Next.js 16 App Router 不原生支持 WebSocket
- 需要自定义服务器或使用 Pages Router
- SSE 对于单向数据流（截图推送）足够

### 2. 元素选择器捕获
通过 `page.evaluate()` 注入脚本：
```javascript
document.addEventListener('click', (e) => {
  e.preventDefault();
  const target = e.target;
  
  // 生成 CSS 选择器
  let cssSelector = target.tagName;
  if (target.id) cssSelector = `#${target.id}`;
  else if (target.className) cssSelector += `.${target.classList[0]}`;
  
  // 生成 XPath
  const xpath = getXPath(target);
  
  // 保存到 window 对象
  window.__pickedElement = { cssSelector, xpath };
});
```

前端轮询 `/api/workflow/picked-element` 获取结果。

### 3. 步骤执行
API 接收步骤定义，根据 `action` 类型执行对应操作：
```typescript
switch (step.action) {
  case 'navigate':
    await page.goto(step.params.url);
    break;
  case 'click':
    await page.click(step.params.selector);
    break;
  case 'type':
    await page.fill(step.params.selector, step.params.value);
    break;
}
```

## 技术架构图

```
┌──────────────────────────────────────────────────────────┐
│                  前端 (React + Next.js)                  │
│  ┌────────────────────┐    ┌─────────────────────────┐  │
│  │  WorkflowEditor    │    │  EventSource (SSE)      │  │
│  │  - 步骤列表        │    │  - 接收截图流           │  │
│  │  - 执行按钮        │    │  - 每秒更新一次         │  │
│  │  - 选择器面板      │    └─────────────────────────┘  │
│  └────────────────────┘                                  │
│          │ POST                       ▲ SSE              │
│          ▼                            │                  │
└──────────────────────────────────────────────────────────┘
           │                            │
┌──────────────────────────────────────────────────────────┐
│              后端 API (Next.js Route Handlers)           │
│  ┌────────────────────┐    ┌─────────────────────────┐  │
│  │ POST /workflow/    │    │ GET /workflow/browser   │  │
│  │ browser            │    │ ?action=screenshot      │  │
│  │ - 执行步骤         │    │ - SSE 截图流            │  │
│  │ - 启用元素选择器   │    └─────────────────────────┘  │
│  └────────────────────┘                                  │
│          │                            │                  │
└──────────────────────────────────────────────────────────┘
           │                            │
           ▼                            │
┌──────────────────────────────────────────────────────────┐
│           持久化浏览器 (Playwright Context)              │
│  - 保持登录状态                                          │
│  - 执行 Playwright 命令                                  │
│  - 截图并返回                                            │
└──────────────────────────────────────────────────────────┘
```

## 与现有流程的关系

### 原发布流程 (`/publish`)
- **保持不变**，不受影响
- 一键自动发布，执行完整流程
- 使用 `lib/publishers/douyin-publish.ts`

### 工作流管理 (`/workflows`)
- **新功能**，独立页面
- 可视化编辑，逐步执行
- 使用相同的持久化浏览器实例

两者共享 `lib/persistent-browser.ts`，但不会互相干扰（除非同时操作）。

## 回答你的疑问

### Q1: 扫码登录如何知道用户是否扫码？
**答**: 通过持久化浏览器 + Cookie 同步：
1. 浏览器扫码登录后，Cookie 自动保存在持久化数据目录
2. Chrome 扩展可以将 Cookie 同步到 Supabase
3. 检测登录状态：访问创作者平台，检查是否跳转到登录页

### Q2: 多用户并发怎么处理？
**答**: 当前使用文件锁 (`/tmp/douyin-publish.lock`) 防止并发：
- 不支持同时多人使用
- 建议做客户端（Tauri + Node sidecar）实现本地隔离
- 或者使用 Docker 容器为每个用户分配独立浏览器实例

### Q3: 是否需要做登录代理？
**答**: **不建议**拦截抖音接口：
- 抖音接口频繁变化，维护成本高
- 可能触发反爬机制
- 持久化浏览器 + Cookie 同步已足够

### Q4: 永不关闭浏览器 vs 按需启动？
**答**: 取决于使用场景：
- **远程服务（你自己用）**: 永不关闭，保持指纹
- **多用户 SaaS**: 客户端 + 本地浏览器，按需启动

### Q5: 可配置化 RPA 是否必要？
**答**: **是的，非常必要**！
- 目前已实现：JSON 配置工作流
- 下一步：可视化编辑 + 录制功能
- 好处：复用流程能力，快速适配新平台（小红书、微信公众号）

## 下一步计划

### 短期（1-2 周）
1. **录制功能** - 操作一遍自动生成工作流
2. **小红书发布** - 复用现有工作流引擎
3. **选择器优化** - 支持多种选择器策略（ID > class > XPath）

### 中期（1-2 月）
4. **客户端开发** (Tauri + Rust)
   - 本地浏览器实例
   - 用户级隔离
   - 支持多账号管理

### 长期（3+ 月）
5. **工作流市场** - 分享和下载社区工作流
6. **AI 辅助编辑** - 自动识别页面元素，智能建议选择器
7. **批量发布** - 队列管理，任务调度

## 测试建议

### 测试工作流管理页面
1. 访问 http://localhost:1007/workflows
2. 等待右侧浏览器预览加载（绿点亮起）
3. 点击任意步骤的"▶ 执行"按钮
4. 观察右侧浏览器截图变化

### 测试元素选择器
1. 点击"🎯 选择元素"按钮
2. 等待浏览器页面显示蓝色提示
3. 在浏览器中点击任意元素（如标题输入框）
4. 查看底部显示的选择器信息
5. 点击"✓ 应用选择器"（需先选中左侧步骤）

### 测试原发布流程
1. 访问 http://localhost:1007/publish
2. 填写标题、选择视频
3. 点击"发布到抖音"
4. 确保功能正常，不受工作流管理影响

## 已知限制

1. **截图延迟**: SSE 流 1 FPS，不是完全实时
2. **并发限制**: 单个浏览器实例，不支持多用户同时使用
3. **WebSocket 未实现**: 需要自定义服务器才能支持真正的 WebSocket
4. **元素选择器**: 只能在截图上点击，实际是轮询检测（0.5 秒一次）

## 总结

✅ **已完成**: 工作流管理页面，浏览器实时预览，元素选择器捕获，配置导出  
✅ **不影响原流程**: `/publish` 页面保持不变  
✅ **可扩展**: JSON 配置化，易于添加新平台（小红书、微信公众号）  
⚠️ **限制**: SSE 截图流（非完全实时），单浏览器实例（不支持并发）

## 页面预览

打开浏览器访问以下地址测试：
- **工作流管理**: http://localhost:1007/workflows
- **原发布页面**: http://localhost:1007/publish
- **RPA 测试**: http://localhost:1007/rpa

左侧导航栏已添加"工作流管理"菜单项 🎉
