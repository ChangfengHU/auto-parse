'use client';

const BASE = 'http://127.0.0.1:1007';
const BASE_ALIAS = 'http://localhost:1007';

interface FieldDoc {
  name: string;
  type: string;
  required?: boolean;
  desc: string;
  example?: string;
}

interface EndpointDoc {
  id: string;
  moduleId: string;
  method: 'GET' | 'POST';
  path: string;
  title: string;
  summary: string;
  aiGuidance: string;
  requestType: string;
  responseType: string;
  query?: FieldDoc[];
  body?: FieldDoc[];
  response: string;
  notes?: string[];
  example?: string;
}

interface ModuleDoc {
  id: string;
  title: string;
  desc: string;
  goal: string;
}

const MODULES: ModuleDoc[] = [
  {
    id: 'media-parse',
    title: '媒体解析',
    desc: '把抖音/小红书分享链接解析成可稳定消费的 OSS 视频地址，适合作为后续发布、归档、训练素材的统一入口。',
    goal: '输入分享链接，输出可长期访问的视频结果。',
  },
  {
    id: 'douyin-publish',
    title: '抖音发布',
    desc: '把已经可下载的视频地址提交到抖音网页端发布流程，并通过 SSE 持续回传日志、二维码、任务 ID 与最终结果。',
    goal: '输入视频地址和文案，驱动真实网页发布。',
  },
  {
    id: 'gemini-image',
    title: 'Gemini 生图调度',
    desc: '把多条 prompt 分发到多个 AdsPower 实例，支持每条 prompt 绑定多张参考图，用于一致性生图和批量产出。',
    goal: '输入 runs 列表，异步调度 Gemini 网页生图任务。',
  },
];

const ENDPOINTS: EndpointDoc[] = [
  {
    id: 'parse-short-video',
    moduleId: 'media-parse',
    method: 'POST',
    path: '/api/parse',
    title: '解析短视频并上传 OSS',
    summary: '解析抖音或小红书分享链接，提取真实视频地址，下载后上传到 OSS，并自动写入素材库。',
    aiGuidance:
      '当 AI 需要把“分享链接/分享口令/含链接的文本”标准化成可长期访问的媒体地址时，优先调用这个接口。对后续发布、剪辑、素材归档，推荐始终使用返回的 ossUrl，而不是原始分享链接。',
    requestType: 'application/json',
    responseType: 'application/json',
    body: [
      {
        name: 'url',
        type: 'string',
        required: true,
        desc: '抖音或小红书分享链接。推荐直接传完整分享文本，服务端会自行识别其中的 URL。',
        example: 'https://v.douyin.com/xxxxxx/',
      },
      {
        name: 'watermark',
        type: 'boolean',
        required: false,
        desc: '仅抖音有效。false 表示走无水印解析，速度较慢但结果更干净；true 表示走快速有水印链路。',
        example: 'false',
      },
    ],
    response: `{
  "success": true,
  "platform": "douyin",
  "videoId": "7481234567890123456",
  "title": "视频标题",
  "videoUrl": "https://原始视频直链.mp4",
  "ossUrl": "https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/7481234567890123456.mp4",
  "watermark": false
}`,
    notes: [
      '当前主接口支持抖音和小红书。若 AI 的目标明确是“解析抖音短视频”，仍然优先走这个接口即可。',
      '成功后素材会自动写入本地素材库，无需额外调用入库接口。',
      '后续如需发布到抖音，应把返回的 ossUrl 作为发布输入源。',
      '失败时返回 JSON 错误对象，典型情况包括链接无效、平台不支持、上游解析失败、OSS 上传失败。',
    ],
    example: `curl -X POST ${BASE}/api/parse \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://v.douyin.com/xxxxxx/",
    "watermark": false
  }'`,
  },
  {
    id: 'douyin-publish-sse',
    moduleId: 'douyin-publish',
    method: 'POST',
    path: '/api/publish',
    title: '发布抖音短视频（SSE 实时流）',
    summary: '驱动抖音网页端发布流程，返回 SSE 数据流，持续推送日志、二维码、taskId 和最终 done/error 事件。',
    aiGuidance:
      '这是一个长任务接口，不是普通一次性 JSON 返回。AI 调用后必须持续读取 SSE 流，逐条解析 data 行中的 JSON 事件。若需要后查任务详情，可使用 taskId 再查询 /api/publish/status。',
    requestType: 'application/json，响应为 text/event-stream',
    responseType: 'SSE（data 行内是 JSON）',
    body: [
      {
        name: 'videoUrl',
        type: 'string',
        required: true,
        desc: '待发布的视频可下载地址。这里的字段名必须是 videoUrl；如果视频已经在 OSS，也仍然要把 OSS 地址放在 videoUrl 字段里，不要传 ossUrl 字段名。',
        example: 'https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/7481234567890123456.mp4',
      },
      {
        name: 'title',
        type: 'string',
        required: true,
        desc: '发布标题。建议控制在 55 字以内，避免超长文案导致网页端输入异常。',
        example: '海边落日的一天，慢一点生活',
      },
      {
        name: 'description',
        type: 'string',
        required: false,
        desc: '正文补充文案。适合放说明性内容、段落、emoji 或补充话题语境。',
        example: '今天的海风刚刚好，分享给你们。#海边 #日常',
      },
      {
        name: 'tags',
        type: 'string[]',
        required: false,
        desc: '话题标签数组。传纯标签名即可，服务端会在网页端按发布逻辑处理，不需要手写 #。',
        example: '["海边", "旅行", "日常"]',
      },
      {
        name: 'clientId',
        type: 'string',
        required: false,
        desc: '推荐的登录凭证标识。服务端会尝试从云端会话表获取 cookie，比直接传 cookieStr 更安全。',
        example: 'douyin_main_account',
      },
      {
        name: 'cookieStr',
        type: 'string',
        required: false,
        desc: '直接传入 cookie 字符串。仅当没有 clientId 且明确需要临时登录态时使用。',
        example: 'sessionid=...; passport_csrf_token=...;',
      },
    ],
    response: `data: {"type":"log","payload":"📋 发布参数：视频=... 标题=\\"海边落日的一天\\""}\n
data: {"type":"taskId","payload":"1748921234567-abc123"}\n
data: {"type":"log","payload":"🔍 检测登录状态..."}\n
data: {"type":"qrcode","payload":"data:image/png;base64,..."}\n
data: {"type":"done","payload":"发布成功 [taskId: 1748921234567-abc123]"}\n`,
    notes: [
      '如果客户端不方便处理 SSE，请不要调用这个接口；应由一个能持续读取流的 Agent 或后端中转来消费。',
      '事件类型目前包括 log、qrcode、taskId、done、error。AI 应对每一种 type 做分支处理。',
      '推荐优先使用 clientId，让服务端自行获取登录态；cookieStr 仅适合临时场景。',
      '如果连接中断，后台任务可能仍在继续；此时应改用 /api/publish/status 查询 taskId 对应状态。',
    ],
    example: `curl -N -X POST ${BASE}/api/publish \\
  -H "Content-Type: application/json" \\
  -d '{
    "videoUrl": "https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/7481234567890123456.mp4",
    "title": "海边落日的一天，慢一点生活",
    "description": "今天的海风刚刚好",
    "tags": ["海边", "旅行", "日常"],
    "clientId": "douyin_main_account"
  }'`,
  },
  {
    id: 'douyin-publish-status',
    moduleId: 'douyin-publish',
    method: 'GET',
    path: '/api/publish/status',
    title: '查询抖音发布任务状态',
    summary: '查询最近发布任务列表，或根据 taskId 查询单个任务详情、阶段截图与最新二维码。',
    aiGuidance:
      '当 /api/publish 的 SSE 连接断开、任务需要补查状态、或者 AI 想在发布完成后拿到阶段信息时，调用这个接口。无 taskId 返回列表；有 taskId 返回详情。',
    requestType: 'URL Query',
    responseType: 'application/json',
    query: [
      {
        name: 'taskId',
        type: 'string',
        required: false,
        desc: '任务 ID。留空时返回最近 20 条任务摘要；传入后返回该任务的详细状态、检查点、二维码信息。',
        example: '1748921234567-abc123',
      },
    ],
    response: `// 列表模式
[
  {
    "taskId": "1748921234567-abc123",
    "status": "done",
    "title": "海边落日的一天，慢一点生活",
    "result": {
      "success": true
    }
  }
]

// 详情模式
{
  "taskId": "1748921234567-abc123",
  "status": "done",
  "checkpoints": [
    {
      "name": "login-check",
      "status": "done",
      "screenshotUrl": "/api/publish/screenshot/1748921234567-abc123/01-login-check.png"
    }
  ],
  "latestQrCode": "data:image/png;base64,...",
  "latestQrUrl": "/api/publish/screenshot/1748921234567-abc123/screenshots/qrcode-001.png"
}`,
    notes: [
      '对 AI 来说，taskId 是发布链路中的关键主键，应在收到 /api/publish 的 taskId 事件后立即持久化。',
      '详情模式下，checkpoints 中会包含可直接访问的 screenshotUrl，适合回放排障。',
      '当 latestQrCode 或 latestQrUrl 存在时，通常意味着登录流程需要扫码介入。',
    ],
    example: `curl "${BASE}/api/publish/status?taskId=1748921234567-abc123"`,
  },
  {
    id: 'gemini-dispatcher-create',
    moduleId: 'gemini-image',
    method: 'POST',
    path: '/api/gemini-web/image/ads-dispatcher',
    title: '创建 Gemini 网页生图调度任务',
    summary: '把多条 prompt 分发到多个 AdsPower 实例执行，支持每条 prompt 携带多张参考图，适合人物一致性、批量分镜、批量海报生成。',
    aiGuidance:
      '推荐优先使用 runs 模式：每个 runs[i] 包含 prompt 和 sourceImageUrls。这样一条 prompt 可以绑定 0-N 张参考图。对于保持人物一致性、风格一致性，这是当前最稳的请求形式。',
    requestType: 'application/json',
    responseType: 'application/json（异步任务创建结果）',
    body: [
      {
        name: 'runs[].prompt',
        type: 'string',
        required: true,
        desc: '单条生成任务的提示词。一个 runs 元素对应一张最终产出图。',
        example: '同一位女生在海边回头微笑，朋友圈质感，真实摄影',
      },
      {
        name: 'runs[].sourceImageUrls',
        type: 'string[]',
        required: false,
        desc: '当前 prompt 绑定的参考图 URL 集合。可为空数组；当需要人物一致性时，建议把三视图或多张定妆图都放在这里。',
        example: '["https://images.xxx/front.png","https://images.xxx/side.png"]',
      },
      {
        name: 'instanceIds',
        type: 'string[]',
        required: false,
        desc: '用于调度的 AdsPower 实例 ID 列表。不传时使用系统默认实例池。',
        example: '["k1b908rw","k1bdaoa7","k1ba8vac"]',
      },
      {
        name: 'workflowId',
        type: 'string',
        required: false,
        desc: '指定工作流 ID。当前推荐传入已配置好多图上传节点的 Ads 工作流。',
        example: '4a163587-6e5e-4176-8178-0915f0429ee0',
      },
      {
        name: 'maxAttemptsPerPrompt',
        type: 'number',
        required: false,
        desc: '单条 prompt 最大尝试次数。任务失败时会按调度策略重试。',
        example: '6',
      },
      {
        name: 'force',
        type: 'boolean',
        required: false,
        desc: '是否强制抢占执行。true 时会清空当前队列并优先启动本次任务，适合紧急任务，但不适合共享环境中的日常调用。',
        example: 'true',
      },
      {
        name: 'sourceImageUrls',
        type: 'string[] | string',
        required: false,
        desc: '兼容字段。若不使用 runs[].sourceImageUrls，可传顶层共享参考图，系统会把同一组图应用到所有 prompt。',
        example: '["https://images.xxx/front.png"]',
      },
      {
        name: 'sourceImageUrlsByPrompt',
        type: 'Array<string[] | string>',
        required: false,
        desc: '兼容字段。与 prompts 数组按索引一一对应，适合旧调用方式逐步迁移到 runs。',
        example: '[["https://images.xxx/a.png"],["https://images.xxx/b.png","https://images.xxx/c.png"]]',
      },
    ],
    response: `{
  "taskId": "c6e6d1b2-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "queued",
  "queryUrl": "/api/gemini-web/image/ads-dispatcher/tasks/c6e6d1b2-...-....",
  "querySummaryUrl": "/api/gemini-web/image/ads-dispatcher/tasks/c6e6d1b2-...-..../summary",
  "cancelUrl": "/api/gemini-web/image/ads-dispatcher/tasks/c6e6d1b2-...-..../cancel"
}`,
    notes: [
      '推荐请求格式是 runs，而不是单纯 prompts。runs 更适合 AI 自动编排，因为 prompt 与参考图天然绑定，不容易错位。',
      'sourceImageUrls 允许为空数组，这代表“当前 prompt 不上传参考图，只走纯文本生图”。',
      '返回的是异步任务创建结果，不是最终图片。AI 需要继续轮询 querySummaryUrl 或 queryUrl。',
      '当前项目已支持“先上传参考图，再输入文本”的 Gemini 工作流顺序，适配多图上传。',
    ],
    example: `curl -X POST ${BASE}/api/gemini-web/image/ads-dispatcher \\
  -H "Content-Type: application/json" \\
  -d '{
    "runs": [
      {
        "prompt": "同一位女生在海边站立微笑，朋友圈真实摄影感",
        "sourceImageUrls": [
          "https://images.vyibc.com/f6a7035ab2814a9b9eb3029063a903a4.png"
        ]
      },
      {
        "prompt": "同一位女生在海边回头看镜头，风吹头发，清新旅行感",
        "sourceImageUrls": [
          "https://images.vyibc.com/f6a7035ab2814a9b9eb3029063a903a4.png"
        ]
      }
    ],
    "instanceIds": ["k1b908rw", "k1bdaoa7", "k1ba8vac"],
    "workflowId": "4a163587-6e5e-4176-8178-0915f0429ee0",
    "maxAttemptsPerPrompt": 6,
    "force": true,
    "forceReason": "urgent",
    "autoCloseTab": false
  }'`,
  },
  {
    id: 'gemini-dispatcher-summary',
    moduleId: 'gemini-image',
    method: 'GET',
    path: '/api/gemini-web/image/ads-dispatcher/tasks/{taskId}/summary',
    title: '查询 Gemini 调度任务摘要',
    summary: '返回轻量级轮询视图，适合前端或 AI 高频轮询任务进度，不包含过多明细。',
    aiGuidance:
      '如果 AI 只需要知道“任务是否完成、进度百分比、是否已经有结果 URL”，优先轮询 summary 接口，负载更小。',
    requestType: 'URL Path',
    responseType: 'application/json',
    response: `{
  "id": "c6e6d1b2-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "running",
  "done": false,
  "progress": {
    "total": 6,
    "completed": 2,
    "percent": 33,
    "pending": 3,
    "running": 1,
    "success": 2,
    "failed": 0,
    "cancelled": 0
  },
  "resultReady": true,
  "result": {
    "mediaUrls": ["https://...png"],
    "imageUrls": ["https://...png"],
    "primaryMediaUrl": "https://...png",
    "primaryImageUrl": "https://...png"
  }
}`,
    notes: [
      '适合 2-5 秒轮询一次的场景。',
      '当 done=true 时，仍建议在需要调试时再补查 detail 接口，获取每个 item 的状态和错误原因。',
    ],
    example: `curl "${BASE}/api/gemini-web/image/ads-dispatcher/tasks/c6e6d1b2-xxxx-xxxx-xxxx-xxxxxxxxxxxx/summary"`,
  },
  {
    id: 'gemini-dispatcher-detail',
    moduleId: 'gemini-image',
    method: 'GET',
    path: '/api/gemini-web/image/ads-dispatcher/tasks/{taskId}',
    title: '查询 Gemini 调度任务详情',
    summary: '返回完整任务信息，包括队列状态、每个 item 的 prompt、参考图、尝试次数、实例分配、结果 URL、失败原因和 trace 入口。',
    aiGuidance:
      '当 AI 需要做失败分析、重试决策、检查哪条 prompt 失败、确认每条 prompt 绑定了哪些参考图时，应查询详情接口，而不是 summary。',
    requestType: 'URL Path',
    responseType: 'application/json',
    response: `{
  "id": "c6e6d1b2-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "failed",
  "queue": {
    "state": "none",
    "size": 0
  },
  "traceUrl": "/api/task-traces?namespace=gemini-ads-dispatcher&taskId=c6e6d1b2-...",
  "result": {
    "mediaUrls": ["https://...png"],
    "items": [
      {
        "index": 0,
        "prompt": "同一位女生在海边站立微笑...",
        "sourceImageUrls": ["https://images.xxx/a.png"],
        "status": "success",
        "attempts": 1,
        "primaryImageUrl": "https://...png"
      },
      {
        "index": 1,
        "prompt": "同一位女生在海边回头看镜头...",
        "sourceImageUrls": [],
        "status": "failed",
        "attempts": 2,
        "error": "子任务失败"
      }
    ]
  }
}`,
    notes: [
      '详情接口已返回 sourceImageUrls，方便 AI 在补跑或重建任务时复用原始参考图配置。',
      '如果要实现“失败项单独重跑”，建议从 result.items 中筛出 failed 项，重新构造 runs 发回创建接口。',
      'traceUrl 适合排查调度层问题；日常轮询一般不需要读取。',
    ],
    example: `curl "${BASE}/api/gemini-web/image/ads-dispatcher/tasks/c6e6d1b2-xxxx-xxxx-xxxx-xxxxxxxxxxxx"`,
  },
];

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
  POST: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
};

function ParamTable({ params }: { params: FieldDoc[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border shadow-sm">
      <table className="w-full text-xs">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">字段</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">类型</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">必填</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">说明</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-card">
          {params.map((item) => (
            <tr key={item.name} className="align-top hover:bg-muted/40">
              <td className="px-4 py-3 font-mono text-primary">{item.name}</td>
              <td className="px-4 py-3 text-indigo-500">{item.type}</td>
              <td className="px-4 py-3">
                {item.required ? (
                  <span className="font-medium text-red-500">是</span>
                ) : (
                  <span className="text-muted-foreground">否</span>
                )}
              </td>
              <td className="px-4 py-3 text-foreground/80">
                <div className="space-y-1">
                  <p>{item.desc}</p>
                  {item.example ? (
                    <p className="font-mono text-[11px] text-muted-foreground">例：{item.example}</p>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModuleCard({ module, count }: { module: ModuleDoc; count: number }) {
  return (
    <a
      href={`#${module.id}`}
      className="group rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/70">Module</p>
          <h2 className="mt-2 text-lg font-semibold text-foreground">{module.title}</h2>
        </div>
        <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          {count} 个接口
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{module.desc}</p>
      <p className="mt-3 text-xs leading-5 text-foreground/75">适合 AI 的目标：{module.goal}</p>
    </a>
  );
}

function EndpointCard({ api }: { api: EndpointDoc }) {
  return (
    <section id={api.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-5 py-4">
        <span className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${METHOD_COLOR[api.method]}`}>
          {api.method}
        </span>
        <code className="text-sm font-semibold text-foreground">{api.path}</code>
        <span className="ml-auto text-sm font-medium text-muted-foreground">{api.title}</span>
      </div>

      <div className="space-y-6 px-6 py-6">
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">用途</p>
          <p className="text-sm leading-7 text-foreground/80">{api.summary}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-muted/40 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">AI 调用建议</p>
            <p className="mt-2 text-sm leading-6 text-foreground/80">{api.aiGuidance}</p>
          </div>
          <div className="rounded-2xl border border-border bg-muted/40 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">协议</p>
            <div className="mt-2 space-y-1 text-sm text-foreground/80">
              <p>请求：{api.requestType}</p>
              <p>响应：{api.responseType}</p>
            </div>
          </div>
        </div>

        {api.query && api.query.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Query 参数</p>
            <ParamTable params={api.query} />
          </div>
        ) : null}

        {api.body && api.body.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Request Body</p>
            <ParamTable params={api.body} />
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Response 示例</p>
          <pre className="overflow-x-auto rounded-2xl border border-border bg-muted p-4 text-[11px] leading-relaxed text-emerald-600 shadow-inner dark:text-emerald-400">
            {api.response}
          </pre>
        </div>

        {api.notes && api.notes.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">调用注意事项</p>
            <ul className="space-y-2 text-sm leading-6 text-foreground/80">
              {api.notes.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary/70" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {api.example ? (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">cURL 示例</p>
            <pre className="overflow-x-auto rounded-2xl border border-border bg-muted p-4 text-[11px] leading-relaxed text-blue-600 shadow-inner dark:text-blue-400">
              {api.example}
            </pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function DocsPage() {
  const modulesWithEndpoints = MODULES.map((module) => ({
    ...module,
    endpoints: ENDPOINTS.filter((api) => api.moduleId === module.id),
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-6 py-8">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
            API Center
          </span>
          <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            当前登记 {ENDPOINTS.length} 个接口
          </span>
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">接口中心</h1>
          <p className="max-w-4xl text-sm leading-7 text-muted-foreground">
            这是给 Agent 和自动化系统使用的静态接口目录。每个接口都按模块登记，并明确说明适用场景、字段含义、异步行为与编排建议。
            推荐优先使用 <code className="rounded bg-muted px-1 py-0.5">{BASE}</code>，
            <code className="ml-1 rounded bg-muted px-1 py-0.5">{BASE_ALIAS}</code> 也可作为本机别名访问。
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {modulesWithEndpoints.map((module) => (
            <ModuleCard key={module.id} module={module} count={module.endpoints.length} />
          ))}
        </div>
      </header>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">推荐编排顺序</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-muted/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">1. 解析</p>
            <p className="mt-2 text-sm leading-6 text-foreground/80">
              对分享链接先调用 <code>/api/parse</code>，拿到稳定的 <code>ossUrl</code>，不要直接把分享链接传给发布链路。
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-muted/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">2. 发布</p>
            <p className="mt-2 text-sm leading-6 text-foreground/80">
              调用 <code>/api/publish</code> 时，视频地址必须放在 <code>videoUrl</code> 字段。若需要补查状态，再查 <code>/api/publish/status</code>。
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-muted/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">3. 生图</p>
            <p className="mt-2 text-sm leading-6 text-foreground/80">
              调用 Gemini 调度时，优先用 <code>runs[].sourceImageUrls</code> 绑定参考图。创建后轮询 summary，排障时再查 detail。
            </p>
          </div>
        </div>
      </section>

      {modulesWithEndpoints.map((module) => (
        <section key={module.id} id={module.id} className="space-y-5 scroll-mt-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-semibold text-foreground">{module.title}</h2>
              <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                {module.endpoints.length} 个接口
              </span>
            </div>
            <p className="text-sm leading-7 text-muted-foreground">{module.desc}</p>
          </div>

          <div className="space-y-6">
            {module.endpoints.map((api) => (
              <EndpointCard key={api.id} api={api} />
            ))}
          </div>
        </section>
      ))}

      <footer className="border-t border-border pt-8 text-xs leading-6 text-muted-foreground">
        默认请求体为 JSON，默认请求头为 <code className="rounded bg-muted px-1 py-0.5">Content-Type: application/json</code>。
        唯一例外是 <code className="rounded bg-muted px-1 py-0.5">/api/publish</code>，它的响应是 SSE 流而不是普通 JSON。
      </footer>
    </div>
  );
}
