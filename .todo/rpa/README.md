# 🤖 RPA 引擎开发待办

## 目标

构建可配置的 RPA 引擎，支持多平台（抖音/微信/小红书/B站）复用核心逻辑。

## 待办任务

### Phase 1: 核心引擎
- [ ] 定义 Workflow/ActionStep 类型系统
- [ ] 实现 RPAEngine 执行器
- [ ] 支持变量注入 ${xxx}
- [ ] 选择器多路降级

### Phase 2: 行为节点
- [ ] navigate - 页面导航
- [ ] click - 点击元素
- [ ] type - 输入文本
- [ ] upload - 上传文件
- [ ] captureQR - 截取二维码
- [ ] waitForLogin - 等待登录
- [ ] extractCookie - 提取 Cookie
- [ ] condition - 条件分支
- [ ] loop - 循环等待
- [ ] emit - 事件发送

### Phase 3: 平台配置
- [ ] 抖音发布工作流
- [ ] 微信公众号发布工作流
- [ ] 小红书发布工作流
- [ ] B站发布工作流

### Phase 4: 管理后台
- [ ] /publish 页面添加 RPA 菜单
- [ ] 工作流可视化编辑器
- [ ] 工作流测试/调试模式
- [ ] Supabase 存储同步

## 详细设计

见 `architecture.md`
