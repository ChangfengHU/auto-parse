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
  GET: 'text-green-400 bg-green-400/10 border-green-400/30',
  POST: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  DELETE: 'text-red-400 bg-red-400/10 border-red-400/30',
};

function ParamTable({ params }: { params: Param[] }) {
  return (
    <table className="w-full text-xs mt-2 border border-gray-800 rounded overflow-hidden">
      <thead className="bg-gray-800/60 text-gray-400">
        <tr>
          <th className="px-3 py-1.5 text-left font-medium">参数</th>
          <th className="px-3 py-1.5 text-left font-medium">类型</th>
          <th className="px-3 py-1.5 text-left font-medium">必填</th>
          <th className="px-3 py-1.5 text-left font-medium">说明</th>
        </tr>
      </thead>
      <tbody>
        {params.map((p) => (
          <tr key={p.name} className="border-t border-gray-800 hover:bg-gray-800/30">
            <td className="px-3 py-1.5 font-mono text-yellow-300">{p.name}</td>
            <td className="px-3 py-1.5 text-purple-400">{p.type}</td>
            <td className="px-3 py-1.5">{p.required ? <span className="text-red-400">是</span> : <span className="text-gray-500">否</span>}</td>
            <td className="px-3 py-1.5 text-gray-300">{p.desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function DocsPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">接口文档</h1>
        <p className="text-gray-400 mt-1 text-sm">
          Base URL：<code className="text-pink-400 bg-gray-800 px-1.5 py-0.5 rounded">{BASE}</code>
          <span className="ml-3 text-gray-600">（parse.vyibc.com → localhost:1007）</span>
        </p>
      </div>

      {/* API List */}
      {APIS.map((api) => (
        <section key={api.path + api.method} className="border border-gray-800 rounded-xl overflow-hidden">
          {/* Title bar */}
          <div className="flex items-center gap-3 px-5 py-3 bg-gray-900">
            <span className={`text-xs font-bold px-2 py-0.5 rounded border font-mono ${METHOD_COLOR[api.method]}`}>
              {api.method}
            </span>
            <code className="text-white font-mono text-sm">{api.path}</code>
            <span className="text-gray-400 text-sm ml-1">{api.title}</span>
          </div>

          <div className="px-5 py-4 space-y-4 bg-gray-950">
            {/* Description */}
            <p className="text-gray-300 text-sm">{api.desc}</p>

            {/* Query params */}
            {api.query && api.query.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Query 参数</p>
                <ParamTable params={api.query} />
              </div>
            )}

            {/* Body params */}
            {api.body && api.body.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Request Body（JSON）</p>
                <ParamTable params={api.body} />
              </div>
            )}

            {/* Response */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">返回示例</p>
              <pre className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-xs text-green-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                {api.response}
              </pre>
            </div>

            {/* Example */}
            {api.example && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">cURL 示例</p>
                <pre className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-xs text-sky-300 overflow-x-auto whitespace-pre-wrap">
                  {api.example}
                </pre>
              </div>
            )}
          </div>
        </section>
      ))}

      {/* Footer */}
      <div className="text-center text-xs text-gray-600 pb-4">
        所有接口均为 JSON 格式，Content-Type: application/json，/api/publish 使用 SSE 流式响应。
      </div>
    </div>
  );
}
