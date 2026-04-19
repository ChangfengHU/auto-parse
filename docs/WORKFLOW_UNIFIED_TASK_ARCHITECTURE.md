# 统一工作流任务架构图

本文描述当前 `workflow task`、`ads-batch`、`ads-dispatcher` 的统一执行抽象，以及后续如何在此基础上继续做调度解耦。

## 1. 总览

```text
┌─────────────────────────────────────────────────────────────────────┐
│                           调用入口层                                 │
├──────────────────────────────┬──────────────────────────────────────┤
│ POST /api/workflows/tasks    │ POST /api/gemini-web/image/ads-...  │
│ GET  /api/workflows/tasks/*  │ GET  /api/gemini-web/image/ads-...  │
│ POST /api/workflows/tasks/*  │ POST /api/gemini-web/image/ads-...  │
└───────────────┬──────────────┴──────────────────────┬───────────────┘
                │                                     │
                ▼                                     ▼
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ app/api/workflows/tasks/*    │        │ ads-dispatcher API           │
│ 仅做 HTTP 协议适配             │        │ 任务编排 / 队列 / 调度策略       │
└───────────────┬──────────────┘        └──────────────┬──────────────┘
                │                                     │
                ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 lib/workflow/workflow-task-cli.ts                  │
│ 统一工作流任务抽象                                                  │
│                                                                     │
│ - startWorkflowTask()                                               │
│ - getWorkflowTask()                                                 │
│ - getWorkflowTaskSummary()                                          │
│ - getWorkflowTaskDetail()                                           │
│ - stopWorkflowTask()                                                │
│ - collectWorkflowTaskArtifacts()                                    │
└───────────────┬─────────────────────────────────────┬───────────────┘
                │                                     │
                │                                     ▼
                │                     ┌──────────────────────────────┐
                │                     │ gemini-ads-batch            │
                │                     │ 子任务批量执行器               │
                │                     │ - 为每个 run 启动 workflow   │
                │                     │ - 轮询 workflow task        │
                │                     │ - 提取 artifacts            │
                │                     │ - 映射为 batch run 状态      │
                │                     └──────────────┬──────────────┘
                │                                     │
                │                                     ▼
                │                     ┌──────────────────────────────┐
                │                     │ gemini-ads-dispatcher       │
                │                     │ 调度器                        │
                │                     │ - 队列/实例租约/重试/暂停      │
                │                     │ - 当前通过 batch 使用 workflow│
                │                     └──────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   统一工作流运行时底座                                │
├──────────────────────────────┬──────────────────────────────────────┤
│ lib/workflow/task-store.ts   │ 内存 + 磁盘持久化任务状态               │
│ lib/workflow/engine.ts       │ 节点执行引擎                           │
│ lib/workflow/workflow-db.ts  │ 工作流定义读取                         │
│ Playwright / Browser Context │ 浏览器执行环境                         │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. 分层职责

### 2.1 API 层

职责：

- 接收 HTTP 请求
- 做参数校验
- 把请求映射到统一任务抽象
- 返回稳定的 JSON 协议

特点：

- 不应再直接持有工作流执行细节
- 不应再自行拼装任务状态
- 后续更换执行器时，API 层不需要重写

### 2.2 `workflow-task-cli` 层

职责：

- 作为统一的“工作流任务控制面”
- 屏蔽 `task-store`、`engine`、浏览器启动、输出变量合并等实现细节
- 提供统一生命周期接口：启动、查询、摘要、停止、提取结果

这是当前解耦的核心边界。

设计原则：

- 所有“工作流作为任务运行”的能力都从这里出
- 上层不依赖 `runWorkflow()`、`createTask()`、`task-store` 细节
- 上层只依赖 task id + 状态 + artifacts

### 2.3 `gemini-ads-batch` 层

职责：

- 接收多个 run
- 为每个 run 选择实例并构造工作流变量
- 通过 `startWorkflowTask()` 启动真正的 workflow task
- 轮询统一 task 状态
- 用 `collectWorkflowTaskArtifacts()` 提取媒体产物
- 把 workflow status 映射成 batch run status

当前映射关系：

- `workflow done` -> `batch success` 或 `batch failed`
- `workflow error` -> `batch failed`
- `workflow stopped` -> `batch cancelled`

说明：

- `done` 不代表一定业务成功，仍要检查是否有合法媒体结果
- 这一步的好处是“执行成功”和“业务产物有效”被明确拆开

### 2.4 `gemini-ads-dispatcher` 层

职责：

- 管理总调度任务
- 控制实例池、租约、重试、冷却、暂停、恢复、取消
- 决定何时为 item 创建子任务

当前状态：

- `dispatcher` 仍然保留自己的队列和调度状态机
- 但子任务执行已不再需要绑定某个专用 WebImageTask 实现
- 未来可继续把“调度策略”和“执行器类型”彻底拆开

## 3. 关键调用链

### 3.1 直接启动工作流任务

```text
Client
  -> POST /api/workflows/tasks
  -> workflow-task-cli.startWorkflowTask()
  -> task-store.createTask()
  -> engine.runWorkflow()
  -> task-store 持续写入步骤状态 / 日志 / finalVars
  -> GET /api/workflows/tasks/:taskId(/summary)
```

### 3.2 dispatcher 触发 Ads 子任务

```text
Client
  -> POST /api/gemini-web/image/ads-dispatcher
  -> createGeminiAdsDispatcherTask()
  -> dispatcher 选择 instance + item
  -> createGeminiAdsBatchTask()
  -> startWorkflowTask()
  -> workflow 执行完成
  -> collectWorkflowTaskArtifacts()
  -> batch run 更新结果
  -> dispatcher 汇总 item 状态
```

## 4. 当前统一后的好处

- 切换工作流时，不需要重写 `ads-batch` 的底层执行模型，只需要替换 `workflowId`
- 工作流 API 与内部调度链开始共享同一套任务生命周期语义
- 子任务结果提取被收口到统一接口，避免不同调用链各自写一套“从 vars / outputs / step logs 提结果”的逻辑
- 停止语义统一，`batch cancel` 可以直接级联到 `workflow task stop`
- 后续可以围绕统一 task 抽象做调度策略，而不是围绕某个具体任务实现做分支

## 5. 当前仍未完全解耦的部分

还没有彻底完成的点：

- `ads-dispatcher` 目前仍然依赖 `ads-batch` 作为中间层
- `dispatcher` 的调度策略还不能直接读取“工作流能力模型”
- `workflow-task-cli` 目前是内部 TypeScript 模块，不是真正 shell 级 CLI
- 不同业务任务的 artifacts 仍以媒体 URL 为主，尚未形成通用 schema

## 6. 下一步推荐演进

建议继续往下面的结构走：

```text
dispatcher
  -> child task adapter
       -> workflow executor
       -> batch executor
       -> future custom executor
```

可以新增一个统一子任务适配协议，例如：

```ts
interface ChildTaskAdapter {
  kind: 'workflow' | 'batch' | 'custom';
  start(input: ChildTaskStartInput): Promise<{ taskId: string }>;
  get(taskId: string): Promise<ChildTaskState | null>;
  stop(taskId: string, reason?: string): Promise<void>;
  collect(taskId: string): Promise<ChildTaskArtifacts>;
}
```

推荐再补这几层抽象：

- `WorkflowExecutor`
  只负责运行工作流任务，不关心调度

- `ChildTaskAdapter`
  负责把不同执行器包装成统一生命周期

- `DispatcherStrategy`
  负责根据工作流返回、失败分类、产物质量决定重试或切换实例

## 7. 理想目标图

```text
┌───────────────────────┐
│   ads-dispatcher      │
│   只关心调度策略         │
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│   ChildTaskAdapter    │
│   统一子任务协议         │
└───────┬─────────┬─────┘
        │         │
        ▼         ▼
┌─────────────┐  ┌──────────────────────┐
│ WorkflowExec│  │ Other Executor       │
│ 统一 workflow│  │ future batch/custom  │
└──────┬──────┘  └──────────────────────┘
       ▼
┌───────────────────────┐
│ workflow-task-cli     │
│ 统一任务控制面          │
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ engine + task-store   │
└───────────────────────┘
```

## 8. 相关文件

- `lib/workflow/workflow-task-cli.ts`
- `app/api/workflows/tasks/route.ts`
- `app/api/workflows/tasks/[taskId]/route.ts`
- `app/api/workflows/tasks/[taskId]/summary/route.ts`
- `app/api/workflows/tasks/[taskId]/stop/route.ts`
- `lib/workflow/gemini-ads-batch.ts`
- `lib/workflow/gemini-ads-dispatcher.ts`
- `app/api/gemini-web/image/tasks/[id]/route.ts`

