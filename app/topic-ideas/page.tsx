'use client';

import { useMemo, useRef, useState } from 'react';
import type { WorkflowDef } from '@/lib/workflow/types';
import { topicPickerDailyHotWorkflow } from '@/lib/workflow/workflows/topic-picker-dailyhot';

type LogLevel = 'info' | 'success' | 'error';
type LogEntry = { time: string; text: string; level: LogLevel };

interface TopicIdea {
  rank: number;
  title: string;
  source: string;
  sourceName: string;
  score: number;
  reason: string;
  expected?: {
    exposure?: number;
    plays?: number;
    fans?: number;
  };
  url?: string;
}

function now() {
  return new Date().toLocaleTimeString('zh-CN');
}

function parseTopicIdeas(input: unknown): TopicIdea[] {
  if (!input) return [];
  if (Array.isArray(input)) return input as TopicIdea[];
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? (parsed as TopicIdea[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function ensureWorkflowExists(def: WorkflowDef): Promise<string> {
  const listRes = await fetch('/api/workflows');
  const list = (await listRes.json()) as WorkflowDef[];
  const workflows = Array.isArray(list) ? list : [];
  const duplicateDailyHot = workflows.filter(
    (item) => item.name === def.name && item.id !== def.id
  );
  if (duplicateDailyHot.length > 0) {
    await Promise.all(
      duplicateDailyHot.map(async (item) => {
        await fetch(`/api/workflows/${item.id}`, { method: 'DELETE' });
      })
    );
  }

  const exists = workflows.find((item) => item.id === def.id);
  if (exists?.id) {
    const updateRes = await fetch(`/api/workflows/${def.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(def),
    });
    if (!updateRes.ok) {
      throw new Error(`更新选题工作流失败（HTTP ${updateRes.status}）`);
    }
    const updated = (await updateRes.json()) as WorkflowDef;
    return updated.id;
  }

  const createRes = await fetch('/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(def),
  });
  if (!createRes.ok) {
    throw new Error(`创建选题工作流失败（HTTP ${createRes.status}）`);
  }
  const created = (await createRes.json()) as WorkflowDef;
  return created.id;
}

async function runWorkflowStep(
  sessionId: string,
  onLog: (text: string, level?: LogLevel) => void
): Promise<{
  done: boolean;
  failed: boolean;
  vars?: Record<string, unknown>;
  output?: Record<string, unknown>;
}> {
  const response = await fetch(`/api/workflow/session/${sessionId}/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok || !response.body) {
    throw new Error(`执行步骤失败（HTTP ${response.status}）`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: {
    done?: boolean;
    failed?: boolean;
    vars?: Record<string, unknown>;
    result?: { output?: Record<string, unknown> };
  } | null = null;

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
        const level: LogLevel = text.includes('❌') ? 'error' : text.includes('✅') ? 'success' : 'info';
        onLog(text, level);
      } else if (payload.type === 'error' && payload.payload) {
        onLog(payload.payload, 'error');
      } else if (payload.type === 'done' && payload.payload) {
        try {
          result = JSON.parse(payload.payload) as {
            done?: boolean;
            failed?: boolean;
            vars?: Record<string, unknown>;
            result?: { output?: Record<string, unknown> };
          };
        } catch {
          result = null;
        }
      }
    }
  }

  return {
    done: Boolean(result?.done),
    failed: Boolean(result?.failed),
    vars: result?.vars,
    output: result?.result?.output,
  };
}

export default function TopicIdeasPage() {
  const [goal, setGoal] = useState('给我当前最具价值的三个选题，目标是获取曝光量、播放量、粉丝增长');
  const [count, setCount] = useState(3);
  const [sources, setSources] = useState('douyin,bilibili,baidu,toutiao,thepaper');
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [topics, setTopics] = useState<TopicIdea[]>([]);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  const canRun = useMemo(() => !running && goal.trim().length > 0, [running, goal]);

  function pushLog(text: string, level: LogLevel = 'info') {
    setLogs((prev) => [...prev, { time: now(), text, level }]);
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
  }

  async function copyLogs() {
    if (logs.length === 0) return;
    const content = logs.map((item) => `[${item.time}] ${item.text}`).join('\n');
    await navigator.clipboard.writeText(content);
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 1800);
  }

  async function handleRun() {
    if (!canRun) return;
    setRunning(true);
    setError('');
    setTopics([]);
    setLogs([]);
    setSessionId('');

    try {
      pushLog('🚀 准备工作流...');
      const workflowId = await ensureWorkflowExists(topicPickerDailyHotWorkflow);
      pushLog(`🧩 当前工作流: ${topicPickerDailyHotWorkflow.name} (${workflowId})`);

      const vars = {
        goal: goal.trim(),
        count: String(Math.max(3, Math.min(5, count))),
        sources: JSON.stringify(
          sources
            .split(/[,\n]/)
            .map((item) => item.trim())
            .filter(Boolean)
        ),
      };
      pushLog(`🧩 输入变量: goal/count/sources`);
      pushLog(`  - goal = ${vars.goal}`);
      pushLog(`  - count = ${vars.count}`);
      pushLog(`  - sources = ${vars.sources}`);

      const sessionRes = await fetch('/api/workflow/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId, vars }),
      });
      const sessionData = await sessionRes.json();
      if (!sessionRes.ok || !sessionData?.sessionId) {
        throw new Error(sessionData?.error || `创建会话失败（HTTP ${sessionRes.status}）`);
      }

      const sid = String(sessionData.sessionId);
      setSessionId(sid);
      pushLog(`✅ 会话创建成功: ${sid}`, 'success');

      let done = false;
      let failed = false;
      let round = 0;
      let latestIdeas: TopicIdea[] = [];

      while (!done && !failed) {
        round += 1;
        pushLog(`▶️ 执行步骤 ${round}...`);
        const step = await runWorkflowStep(sid, (text, level) => pushLog(text, level));
        latestIdeas = [
          ...latestIdeas,
          ...parseTopicIdeas(step.output?.topicIdeas),
          ...parseTopicIdeas(step.vars?.topicIdeas),
        ];
        const unique = new Map<string, TopicIdea>();
        for (const idea of latestIdeas) {
          const key = `${idea.title}-${idea.source}`;
          if (!unique.has(key)) unique.set(key, idea);
        }
        setTopics(Array.from(unique.values()).sort((a, b) => (a.rank || 999) - (b.rank || 999)));
        done = step.done;
        failed = step.failed;
      }

      if (failed) {
        throw new Error('工作流执行失败，请查看日志');
      }
      pushLog('✅ 选题生成完成', 'success');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      pushLog(`❌ ${message}`, 'error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">今日选题</h1>
        <p className="text-sm text-muted-foreground mt-1">先拉取 DailyHot 候选并健康检查，再交给 LLM 过滤输出 3-5 条可执行选题。</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">任务目标</label>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm resize-y"
            placeholder="例如：给我当前最具价值的三个选题，目标涨粉"
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">输出数量（3-5）</label>
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
            >
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">热点来源（逗号分隔）</label>
            <input
              value={sources}
              onChange={(e) => setSources(e.target.value)}
              className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
              placeholder="douyin,bilibili,baidu,toutiao,thepaper"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleRun()}
            disabled={!canRun}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-50"
          >
            {running ? '生成中...' : '获取今日选题'}
          </button>
          {sessionId && <span className="text-xs text-muted-foreground">session: {sessionId}</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">执行日志</h2>
            <button
              onClick={() => void copyLogs()}
              disabled={logs.length === 0}
              className="px-2.5 py-1 rounded-md border border-border text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
            >
              {copiedLogs ? '已复制' : '复制日志'}
            </button>
          </div>
          <div className="h-[460px] overflow-auto rounded-lg bg-black/90 p-3 font-mono text-xs space-y-1">
            {logs.length === 0 ? (
              <div className="text-zinc-500">等待执行...</div>
            ) : (
              logs.map((log, idx) => (
                <div
                  key={idx}
                  className={log.level === 'error' ? 'text-red-400' : log.level === 'success' ? 'text-green-400' : 'text-zinc-300'}
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
          <h2 className="text-sm font-semibold mb-3">选题结果</h2>
          <div className="space-y-3 max-h-[460px] overflow-auto">
            {topics.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无选题结果</div>
            ) : (
              topics.map((topic, idx) => (
                <div key={`${topic.title}-${idx}`} className="border border-border rounded-lg p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-medium">{topic.rank || idx + 1}. {topic.title}</div>
                    <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">Score {topic.score}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    来源：{topic.sourceName} ({topic.source})
                  </div>
                  <div className="text-xs text-muted-foreground">{topic.reason}</div>
                  {topic.expected && (
                    <div className="text-xs text-muted-foreground">
                      预估：曝光 {topic.expected.exposure ?? '-'} · 播放 {topic.expected.plays ?? '-'} · 涨粉 {topic.expected.fans ?? '-'}
                    </div>
                  )}
                  {topic.url ? (
                    <a href={topic.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline break-all">
                      {topic.url}
                    </a>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
