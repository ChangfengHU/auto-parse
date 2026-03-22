'use client';

const BASE = 'http://localhost:1007';

interface Param {
  name: string;
  type: string;
  required?: boolean;
  desc: string;
}

interface ApiDoc {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  title: string;
  desc: string;
  query?: Param[];
  body?: Param[];
  response: string;
  example?: string;
}

const APIS: ApiDoc[] = [
  {
    method: 'POST',
    path: '/api/parse',
    title: '视频解析',
    desc: '解析抖音/小红书视频链接，去水印后上传 OSS，结果自动存入素材库。',
    body: [
      { name: 'url', type: 'string', required: true, desc: '抖音或小红书分享链接' },
    ],
    response: `{
  "platform": "douyin",
  "title": "视频标题",
  "videoUrl": "https://原始地址",
  "ossUrl": "https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/xxx.mp4",
  "coverUrl": "https://封面地址",
  "watermark": false
}`,
    example: `curl -X POST ${BASE}/api/parse \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://v.douyin.com/xxx"}'`,
  },
  {
    method: 'GET',
    path: '/api/materials',
    title: '获取素材列表',
    desc: '返回所有已存档的素材，按解析时间倒序排列。',
    response: `[
  {
    "id": "mat_1748921234567_abc",
    "platform": "douyin",
    "title": "视频标题",
    "videoUrl": "https://原始地址",
    "ossUrl": "https://articel.oss-cn-hangzhou.aliyuncs.com/douyin/xxx.mp4",
    "coverUrl": "https://封面",
    "watermark": false,
    "parsedAt": 1748921234567,
    "publishedAt": 1748921368000,
    "lastTaskId": "1748921234567-abc123"
  }
]`,
    example: `curl ${BASE}/api/materials`,
  },
  {
    method: 'POST',
    path: '/api/materials',
    title: '新增素材',
    desc: '手动添加一条素材记录。',
    body: [
      { name: 'platform', type: 'string', required: true, desc: 'douyin / xiaohongshu' },
      { name: 'title', type: 'string', required: true, desc: '视频标题' },
      { name: 'videoUrl', type: 'string', required: true, desc: '原始视频地址' },
      { name: 'ossUrl', type: 'string', required: true, desc: 'OSS 永久地址' },
      { name: 'coverUrl', type: 'string', required: false, desc: '封面图地址' },
      { name: 'watermark', type: 'boolean', required: false, desc: '是否含水印' },
    ],
    response: `{ "id": "mat_xxx", "platform": "douyin", ... }`,
    example: `curl -X POST ${BASE}/api/materials \\
  -H "Content-Type: application/json" \\
  -d '{"platform":"douyin","title":"xxx","videoUrl":"...","ossUrl":"..."}'`,
  },
  {
    method: 'DELETE',
    path: '/api/materials?id=xxx',
    title: '删除素材',
    desc: '按 id 删除一条素材记录。',
    query: [
      { name: 'id', type: 'string', required: true, desc: '素材 id' },
    ],
    response: `{ "ok": true }`,
    example: `curl -X DELETE "${BASE}/api/materials?id=mat_xxx"`,
  },
  {
    method: 'POST',
    path: '/api/publish',
    title: '发布视频（SSE 流）',
    desc: '将 OSS 视频发布到抖音。返回 SSE 流（text/event-stream），实时推送进度日志。连接断开后发布任务仍在后台继续。',
    body: [
      { name: 'ossUrl', type: 'string', required: true, desc: 'OSS 视频地址' },
      { name: 'title', type: 'string', required: true, desc: '发布标题（≤55字）' },
      { name: 'description', type: 'string', required: false, desc: '正文内容（支持换行和话题）' },
      { name: 'tags', type: 'string[]', required: false, desc: '话题标签数组，不含 #' },
    ],
    response: `data: [TASK] 1748921234567-abc123\n
data: 🔍 检测登录状态...\n
data: ✅ 已登录，直接进入上传页\n
data: 📤 开始上传视频...\n
data: ⏳ 上传中... 45%  (30s)\n
data: ✅ Checkpoint 1：视频上传成功\n
data: ✏️ Checkpoint 2：填写标题...\n
data: ✅ Checkpoint 2：标题已填写\n
data: 🖼️ Checkpoint 3：封面已自动生成\n
data: 检测中 40%  (9s)\n
data: 检测通过 ✅\n
data: [DONE] 发布成功！视频已提交抖音审核\n`,
    example: `curl -N -X POST ${BASE}/api/publish \\
  -H "Content-Type: application/json" \\
  -d '{"ossUrl":"https://...mp4","title":"视频标题"}'`,
  },
  {
    method: 'GET',
    path: '/api/publish/status',
    title: '任务列表',
    desc: '返回最近 20 条发布任务的摘要信息，按时间倒序。',
    response: `[
  {
    "taskId": "1748921234567-abc123",
    "status": "done",
    "videoUrl": "https://...mp4",
    "startedAt": 1748921234567,
    "completedAt": 1748921368000
  }
]`,
    example: `curl ${BASE}/api/publish/status`,
  },
  {
    method: 'GET',
    path: '/api/publish/status?taskId=xxx',
    title: '任务详情',
    desc: '查询单个发布任务的完整状态，含各阶段截图 URL 和最新二维码 base64。',
    query: [
      { name: 'taskId', type: 'string', required: true, desc: '任务 ID（首行日志中的 [TASK] 值）' },
    ],
    response: `{
  "taskId": "1748921234567-abc123",
  "status": "done",          // running | done | error
  "videoUrl": "https://...mp4",
  "startedAt": 1748921234567,
  "completedAt": 1748921368000,
  "stages": [
    {
      "name": "login-check",
      "status": "done",      // pending | running | done | error
      "ts": 1748921234800,
      "screenshotUrl": "/api/publish/screenshot/xxx/01-login-check.png"
    },
    { "name": "upload-page",     "status": "done", "ts": 1748921235200 },
    { "name": "cp1-upload",      "status": "done", "ts": 1748921368000 },
    { "name": "cp2-title",       "status": "done", "ts": 1748921370000 },
    { "name": "cp3-cover",       "status": "done", "ts": 1748921372000 },
    { "name": "cp4-detect",      "status": "done", "ts": 1748921374000 },
    { "name": "publish-success", "status": "done", "ts": 1748921376000 }
  ],
  "latestQr": null,           // data:image/png;base64,... 未登录时有值
  "logs": ["[TASK] 1748921234567-abc123", "..."]
}`,
    example: `curl "${BASE}/api/publish/status?taskId=1748921234567-abc123"`,
  },
  {
    method: 'GET',
    path: '/api/publish/screenshot/:taskId/:filename',
    title: '任务截图',
    desc: '返回指定任务某个检查点的截图文件（PNG）。screenshotUrl 字段直接可用。',
    query: [
      { name: 'taskId', type: 'string', required: true, desc: '任务 ID（路径参数）' },
      { name: 'filename', type: 'string', required: true, desc: '截图文件名（路径参数），如 01-login-check.png' },
    ],
    response: `图片二进制流（image/png）`,
    example: `curl "${BASE}/api/publish/screenshot/1748921234567-abc123/01-login-check.png" -o shot.png`,
  },
];

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
  POST: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
  DELETE: 'text-red-500 bg-red-500/10 border-red-500/20',
};

function ParamTable({ params }: { params: Param[] }) {
  return (
    <div className="border border-border rounded-xl overflow-hidden shadow-sm">
      <table className="w-full text-xs">
        <thead className="bg-muted text-muted-foreground uppercase tracking-wider text-[10px] font-bold">
          <tr>
            <th className="px-4 py-2 text-left font-medium">参数</th>
            <th className="px-4 py-2 text-left font-medium">类型</th>
            <th className="px-4 py-2 text-left font-medium">必填</th>
            <th className="px-4 py-2 text-left font-medium">说明</th>
          </tr>
        </thead>
        <tbody className="bg-card divide-y divide-border">
          {params.map((p) => (
            <tr key={p.name} className="hover:bg-muted/50 transition-colors">
              <td className="px-4 py-2.5 font-mono text-primary font-semibold">{p.name}</td>
              <td className="px-4 py-2.5 text-indigo-500/80">{p.type}</td>
              <td className="px-4 py-2.5">{p.required ? <span className="text-red-500 font-medium">是</span> : <span className="text-muted-foreground/60">否</span>}</td>
              <td className="px-4 py-2.5 text-foreground/80">{p.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">接口文档</h1>
        <p className="text-muted-foreground mt-1 text-sm flex items-center gap-2">
          Base URL：
          <code className="text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded font-mono font-medium">{BASE}</code>
          <span className="text-muted-foreground/40 font-mono text-xs">（localhost:1007）</span>
        </p>
      </div>

      {/* API List */}
      {APIS.map((api) => (
        <section key={api.path + api.method} className="border border-border rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
          {/* Title bar */}
          <div className="flex items-center gap-3 px-5 py-3.5 bg-card border-b border-border">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border tracking-wider uppercase font-mono ${METHOD_COLOR[api.method]}`}>
              {api.method}
            </span>
            <code className="text-foreground font-mono text-sm font-semibold">{api.path}</code>
            <span className="text-muted-foreground text-sm ml-auto font-medium">{api.title}</span>
          </div>

          <div className="px-6 py-5 space-y-5 bg-card/50">
            {/* Description */}
            <p className="text-foreground/70 text-sm leading-relaxed">{api.desc}</p>

            {/* Query params */}
            {api.query && api.query.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Query Params</p>
                <ParamTable params={api.query} />
              </div>
            )}

            {/* Body params */}
            {api.body && api.body.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Request Body (JSON)</p>
                <ParamTable params={api.body} />
              </div>
            )}

            {/* Response */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Response JSON</p>
              <pre className="bg-muted border border-border rounded-xl p-4 text-[11px] text-emerald-600 dark:text-emerald-400 overflow-x-auto font-mono leading-relaxed shadow-inner">
                {api.response}
              </pre>
            </div>

            {/* Example */}
            {api.example && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">cURL Example</p>
                <pre className="bg-muted border border-border rounded-xl p-4 text-[11px] text-blue-600 dark:text-blue-400 overflow-x-auto font-mono leading-relaxed shadow-inner">
                  {api.example}
                </pre>
              </div>
            )}
          </div>
        </section>
      ))}

      {/* Footer */}
      <div className="text-center text-xs text-muted-foreground/60 pb-8 border-t border-border pt-8 mt-4 leading-relaxed">
        所有接口均使用 JSON 格式交互，默认请求头：<code className="bg-muted px-1 rounded">Content-Type: application/json</code>。<br />
        <span className="text-primary font-medium">/api/publish</span> 接口特殊，采用 SSE（Server-Sent Events）推送实时任务进度。
      </div>
    </div>
  );
}
