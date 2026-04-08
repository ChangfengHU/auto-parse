'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WorkflowDef } from '@/lib/workflow/types';

type LogEntry = {
  time: string;
  level: 'info' | 'success' | 'error';
  text: string;
};

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN');
}

function addLog(setter: React.Dispatch<React.SetStateAction<LogEntry[]>>, text: string, level: LogEntry['level'] = 'info') {
  setter((prev) => [...prev, { time: nowTime(), text, level }]);
}

function isUrlLike(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function maybeImageUrl(value: string) {
  const v = value.toLowerCase();
  return (
    isUrlLike(value) &&
    (/\.(png|jpg|jpeg|webp|gif|bmp|svg)(\?|$)/i.test(v) ||
      v.includes('oss-') ||
      v.includes('aliyuncs.com') ||
      v.includes('xhscdn.com'))
  );
}

function collectImageUrls(input: unknown, target: Set<string>) {
  if (input == null) return;
  if (typeof input === 'string') {
    const value = input.trim();
    if (!value) return;
    if (maybeImageUrl(value)) {
      target.add(value);
      return;
    }
    if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
      try {
        collectImageUrls(JSON.parse(value), target);
      } catch {
        // ignore non-json strings
      }
    }
    return;
  }
  if (Array.isArray(input)) {
    input.forEach((item) => collectImageUrls(item, target));
    return;
  }
  if (typeof input === 'object') {
    Object.values(input as Record<string, unknown>).forEach((v) => collectImageUrls(v, target));
  }
}

async function runOneStep(
  sessionId: string,
  onLog: (line: string, level?: LogEntry['level']) => void
): Promise<{ done: boolean; failed: boolean; vars?: Record<string, unknown>; output?: Record<string, unknown> }> {
  const res = await fetch(`/api/workflow/session/${sessionId}/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok || !res.body) {
    throw new Error(`执行步骤失败（HTTP ${res.status}）`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload: { done?: boolean; failed?: boolean; vars?: Record<string, unknown>; result?: { output?: Record<string, unknown> } } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let payload: { type?: string; payload?: string } | null = null;
      try {
        payload = JSON.parse(line.slice(6)) as { type?: string; payload?: string };
      } catch {
        continue;
      }
      if (!payload?.type) continue;

      if (payload.type === 'log' && payload.payload) {
        const text = payload.payload;
        const level: LogEntry['level'] = text.includes('❌') ? 'error' : text.includes('✅') ? 'success' : 'info';
        onLog(text, level);
      } else if (payload.type === 'error' && payload.payload) {
        onLog(payload.payload, 'error');
      } else if (payload.type === 'done' && payload.payload) {
        try {
          donePayload = JSON.parse(payload.payload);
        } catch {
          donePayload = null;
        }
      }
    }
  }

  return {
    done: Boolean(donePayload?.done),
    failed: Boolean(donePayload?.failed),
    vars: donePayload?.vars,
    output: donePayload?.result?.output,
  };
}

export default function ImageGeneratePage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [workflowId, setWorkflowId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/workflows')
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d)) return;
        setWorkflows(d);
        const preferred =
          d.find((w: WorkflowDef) => w.name.includes('gemini流程管理')) ||
          d.find((w: WorkflowDef) => w.name.toLowerCase().includes('gemini')) ||
          d[0];
        if (preferred?.id) setWorkflowId(preferred.id);
      })
      .catch(() => setError('加载工作流失败'));
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const selectedWorkflow = useMemo(
    () => workflows.find((w) => w.id === workflowId) || null,
    [workflows, workflowId]
  );

  async function handleCreateImage() {
    if (!workflowId || !prompt.trim()) return;
    setRunning(true);
    setError('');
    setLogs([]);
    setImageUrls([]);
    setSessionId(null);

    try {
      addLog(setLogs, '🚀 创建工作流会话...');
      const normalizedPrompt = prompt.trim();
      const vars: Record<string, string> = {
        prompt: normalizedPrompt,
        userPrompt: normalizedPrompt,
        noteUrl: normalizedPrompt,
        note_url: normalizedPrompt,
        text: normalizedPrompt,
        input: normalizedPrompt,
        prompts: JSON.stringify([normalizedPrompt]),
      };
      addLog(setLogs, '🧩 本次工作流入参:');
      Object.entries(vars).forEach(([key, value]) => {
        addLog(setLogs, `  - ${key} = ${value}`);
      });
      const sessionRes = await fetch('/api/workflow/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId, vars }),
      });
      const sessionData = await sessionRes.json();
      if (!sessionRes.ok || !sessionData?.sessionId) {
        throw new Error(sessionData?.error || `创建会话失败（HTTP ${sessionRes.status}）`);
      }
      const sid = sessionData.sessionId as string;
      setSessionId(sid);
      addLog(setLogs, `✅ 会话已创建：${sid}`, 'success');

      const foundUrls = new Set<string>();
      let done = false;
      let failed = false;
      let round = 0;

      while (!done && !failed) {
        round += 1;
        addLog(setLogs, `▶️ 开始执行第 ${round} 步...`);
        const step = await runOneStep(sid, (line, level = 'info') => addLog(setLogs, line, level));
        collectImageUrls(step.output, foundUrls);
        collectImageUrls(step.vars, foundUrls);
        setImageUrls(Array.from(foundUrls));
        done = step.done;
        failed = step.failed;
      }

      if (failed) {
        addLog(setLogs, '❌ 工作流执行失败，请查看日志', 'error');
      } else {
        addLog(setLogs, '✅ 工作流执行完成', 'success');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addLog(setLogs, `❌ ${msg}`, 'error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">图片生成</h1>
        <p className="text-sm text-muted-foreground mt-1">输入提示词，调用 Gemini 工作流生成图片并回显 URL。</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">关联工作流</label>
            <select
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
            >
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="text-xs text-muted-foreground flex items-end">
            {selectedWorkflow ? `节点数：${selectedWorkflow.nodes.length}` : '暂无可用工作流'}
          </div>
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">提示词</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="例如：赛博朋克风格，夜晚街道，电影光影，8k"
            className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm resize-y"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleCreateImage()}
            disabled={running || !workflowId || !prompt.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-50"
          >
            {running ? '生成中...' : '创建图片'}
          </button>
          {sessionId && <span className="text-xs text-muted-foreground">session: {sessionId}</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">执行日志</h2>
          <div className="h-[420px] overflow-auto rounded-lg bg-black/90 p-3 font-mono text-xs space-y-1">
            {logs.length === 0 ? (
              <div className="text-zinc-500">等待执行...</div>
            ) : (
              logs.map((log, idx) => (
                <div
                  key={idx}
                  className={
                    log.level === 'error' ? 'text-red-400' : log.level === 'success' ? 'text-green-400' : 'text-zinc-300'
                  }
                >
                  <span className="text-zinc-500 mr-2">[{log.time}]</span>
                  {log.text}
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">生成图片 URL</h2>
          <div className="space-y-3 max-h-[420px] overflow-auto">
            {imageUrls.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无图片 URL</div>
            ) : (
              imageUrls.map((url, idx) => (
                <div key={url} className="border border-border rounded-lg p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">图片 {idx + 1}</div>
                  <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary break-all hover:underline">
                    {url}
                  </a>
                  <div className="flex gap-2">
                    <button
                      onClick={() => navigator.clipboard.writeText(url)}
                      className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-muted"
                    >
                      复制 URL
                    </button>
                    <button
                      onClick={() => router.push(`/publish?ossUrl=${encodeURIComponent(url)}&title=${encodeURIComponent(prompt.slice(0, 30) || `图片${idx + 1}`)}`)}
                      className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-muted"
                    >
                      去发布页
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
