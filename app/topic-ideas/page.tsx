'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

interface DailyHotSourceStat {
  source: string;
  status: 'ok' | 'unsupported' | 'disabled' | 'failed';
  itemCount: number;
  sourceName?: string;
  httpStatus?: number;
  error?: string;
}

interface SourceTopicItem {
  id: string;
  title: string;
  rank: number;
  hotValue?: number;
  timestamp?: number;
  url?: string;
}

interface SourceTopicList {
  source: string;
  sourceName: string;
  items: SourceTopicItem[];
}

interface TopicIdeasDetail {
  summary?: string;
  llm?: { provider?: string; model?: string; baseUrl?: string };
  prompt?: { system?: string; userTemplate?: string; candidateLimit?: number };
  fetch?: {
    baseUrl?: string;
    requestedSources?: string[];
    effectiveSources?: string[];
    availableSources?: string[];
    enabledSources?: string[];
    disabledSources?: string[];
    stats?: DailyHotSourceStat[];
    topicLists?: SourceTopicList[];
  };
}

type AgentNodeType = 'agent_react' | 'topic_picker_agent';
const AGENT_NODE_TYPES = new Set<AgentNodeType>(['agent_react', 'topic_picker_agent']);
const FALLBACK_WORKFLOW = topicPickerDailyHotWorkflow;

function isAgentNodeType(value: string): value is AgentNodeType {
  return AGENT_NODE_TYPES.has(value as AgentNodeType);
}

function findAgentNode(workflow: WorkflowDef): { index: number; type: AgentNodeType } | null {
  for (let index = 0; index < workflow.nodes.length; index += 1) {
    const node = workflow.nodes[index];
    if (isAgentNodeType(node.type)) {
      return { index, type: node.type };
    }
  }
  return null;
}

const FALLBACK_AGENT = findAgentNode(FALLBACK_WORKFLOW);
const FALLBACK_AGENT_PARAMS =
  (FALLBACK_AGENT ? (FALLBACK_WORKFLOW.nodes[FALLBACK_AGENT.index]?.params as Record<string, unknown>) : {}) ?? {};
const REACT_DEFAULT_TOOLS = 'dailyhot.fetch_topics';
const REACT_DEFAULT_MAX_TURNS = 8;

function shouldMigrateToReactAgent(workflow: WorkflowDef): boolean {
  if (workflow.id !== FALLBACK_WORKFLOW.id) return false;
  const hit = findAgentNode(workflow);
  return hit?.type === 'topic_picker_agent';
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

function parseTopicIdeasDetail(input: unknown): TopicIdeasDetail | null {
  if (!input) return null;
  if (typeof input === 'object' && !Array.isArray(input)) return input as TopicIdeasDetail;
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as TopicIdeasDetail;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function buildRuntimeWorkflow(def: WorkflowDef, nodeIndex: number, paramsPatch: Record<string, unknown>): WorkflowDef {
  return {
    ...def,
    nodes: def.nodes.map((node, idx) =>
      idx === nodeIndex ? { ...node, params: { ...node.params, ...paramsPatch } } : node
    ),
  };
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
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [workflowId, setWorkflowId] = useState(FALLBACK_WORKFLOW.id);
  const [workflowDef, setWorkflowDef] = useState<WorkflowDef>(FALLBACK_WORKFLOW);
  const [agentNodeIndex, setAgentNodeIndex] = useState<number>(FALLBACK_AGENT?.index ?? 0);
  const [agentNodeType, setAgentNodeType] = useState<AgentNodeType>(FALLBACK_AGENT?.type ?? 'agent_react');
  const [loadingWorkflow, setLoadingWorkflow] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [saveHint, setSaveHint] = useState('');
  const [llmProvider, setLlmProvider] = useState(String(FALLBACK_AGENT_PARAMS.llmProvider ?? 'qianwen'));
  const [llmModel, setLlmModel] = useState(String(FALLBACK_AGENT_PARAMS.llmModel ?? 'qwen-turbo'));
  const [llmBaseUrl, setLlmBaseUrl] = useState(
    String(FALLBACK_AGENT_PARAMS.llmBaseUrl ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  );
  const [llmApiKeyEnv, setLlmApiKeyEnv] = useState(String(FALLBACK_AGENT_PARAMS.llmApiKeyEnv ?? 'QWEN_API_KEY'));
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmSystemPrompt, setLlmSystemPrompt] = useState(
    String(FALLBACK_AGENT_PARAMS.systemPrompt ?? FALLBACK_AGENT_PARAMS.llmSystemPrompt ?? '')
  );
  const [llmUserPromptTemplate, setLlmUserPromptTemplate] = useState(
    String(FALLBACK_AGENT_PARAMS.userPromptTemplate ?? FALLBACK_AGENT_PARAMS.llmUserPromptTemplate ?? '')
  );
  const [agentTools, setAgentTools] = useState(
    Array.isArray(FALLBACK_AGENT_PARAMS.tools)
      ? (FALLBACK_AGENT_PARAMS.tools as unknown[]).map((item) => String(item).trim()).filter(Boolean).join(',')
      : String(FALLBACK_AGENT_PARAMS.tools ?? '')
  );
  const [agentMaxTurns, setAgentMaxTurns] = useState(Number(FALLBACK_AGENT_PARAMS.maxTurns ?? 6) || 6);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [topics, setTopics] = useState<TopicIdea[]>([]);
  const [topicDetail, setTopicDetail] = useState<TopicIdeasDetail | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);

  const canRun = useMemo(
    () => !running && !loadingWorkflow && goal.trim().length > 0 && workflowDef.nodes.length > 0,
    [running, loadingWorkflow, goal, workflowDef]
  );

  const ensureReactDefaultWorkflow = useCallback(async (candidate: WorkflowDef): Promise<WorkflowDef> => {
    if (!shouldMigrateToReactAgent(candidate)) return candidate;
    const payload = {
      name: FALLBACK_WORKFLOW.name,
      description: FALLBACK_WORKFLOW.description ?? '',
      vars: FALLBACK_WORKFLOW.vars,
      nodes: FALLBACK_WORKFLOW.nodes,
    };
    const res = await fetch(`/api/workflows/${encodeURIComponent(candidate.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`默认工作流迁移失败（HTTP ${res.status}）`);
    }
    return (await res.json()) as WorkflowDef;
  }, []);

  function loadAgentParams(def: WorkflowDef) {
    const hit = findAgentNode(def);
    if (!hit) throw new Error('关联工作流中未找到 agent 节点（agent_react/topic_picker_agent）');
    const params = (def.nodes[hit.index]?.params as Record<string, unknown>) ?? {};
    setAgentNodeIndex(hit.index);
    setAgentNodeType(hit.type);
    setLlmProvider(String(params.llmProvider ?? 'qianwen'));
    setLlmModel(String(params.llmModel ?? 'qwen-turbo'));
    setLlmBaseUrl(String(params.llmBaseUrl ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1'));
    setLlmApiKeyEnv(String(params.llmApiKeyEnv ?? 'QWEN_API_KEY'));
    setLlmSystemPrompt(String(params.systemPrompt ?? params.llmSystemPrompt ?? ''));
    setLlmUserPromptTemplate(String(params.userPromptTemplate ?? params.llmUserPromptTemplate ?? ''));
    const tools = Array.isArray(params.tools)
      ? (params.tools as unknown[]).map((item) => String(item).trim()).filter(Boolean).join(',')
      : String(params.tools ?? '');
    const enforcePureAgentDefaults = def.id === FALLBACK_WORKFLOW.id && hit.type === 'agent_react';
    setAgentTools(enforcePureAgentDefaults ? REACT_DEFAULT_TOOLS : tools);
    setAgentMaxTurns(
      enforcePureAgentDefaults
        ? REACT_DEFAULT_MAX_TURNS
        : (Number(params.maxTurns ?? REACT_DEFAULT_MAX_TURNS) || REACT_DEFAULT_MAX_TURNS)
    );
  }

  useEffect(() => {
    let active = true;
    async function init() {
      setLoadingWorkflow(true);
      try {
        const res = await fetch('/api/workflows');
        const list = res.ok ? ((await res.json()) as WorkflowDef[]) : [];
        if (!active) return;
        const preferred =
          list.find((item) => item.id === FALLBACK_WORKFLOW.id) ??
          list.find((item) => Boolean(findAgentNode(item))) ??
          FALLBACK_WORKFLOW;
        let effective = preferred;
        try {
          effective = await ensureReactDefaultWorkflow(preferred);
        } catch (e) {
          setSaveHint(e instanceof Error ? e.message : String(e));
        }
        setWorkflows(list.map((item) => (item.id === effective.id ? effective : item)));
        setWorkflowId(effective.id);
        setWorkflowDef(effective);
        loadAgentParams(effective);
      } catch {
        if (!active) return;
        setWorkflows([FALLBACK_WORKFLOW]);
        setWorkflowId(FALLBACK_WORKFLOW.id);
        setWorkflowDef(FALLBACK_WORKFLOW);
        loadAgentParams(FALLBACK_WORKFLOW);
      } finally {
        if (active) {
          initializedRef.current = true;
          setLoadingWorkflow(false);
        }
      }
    }
    void init();
    return () => {
      active = false;
    };
  }, [ensureReactDefaultWorkflow]);

  useEffect(() => {
    if (!initializedRef.current) return;
    if (!workflowId) return;
    let active = true;
    async function loadById() {
      setLoadingWorkflow(true);
      try {
        const res = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}`);
        if (!res.ok) throw new Error('加载关联工作流失败');
        const loaded = (await res.json()) as WorkflowDef;
        const def = await ensureReactDefaultWorkflow(loaded);
        if (!active) return;
        setWorkflowDef(def);
        setWorkflows((prev) => prev.map((item) => (item.id === def.id ? def : item)));
        loadAgentParams(def);
      } catch {
        if (!active) return;
        setSaveHint('加载关联工作流失败，已保留当前页面配置');
      } finally {
        if (active) setLoadingWorkflow(false);
      }
    }
    void loadById();
    return () => {
      active = false;
    };
  }, [ensureReactDefaultWorkflow, workflowId]);

  const persistWorkflowPatch = useCallback(async (nodeParamsPatch: Record<string, unknown>) => {
    const nextNodes = workflowDef.nodes.map((node, idx) =>
      idx === agentNodeIndex ? { ...node, params: { ...node.params, ...nodeParamsPatch } } : node
    );
    const payload = {
      name: workflowDef.name,
      description: workflowDef.description ?? '',
      vars: workflowDef.vars,
      nodes: nextNodes,
    };
    const res = await fetch(`/api/workflows/${encodeURIComponent(workflowDef.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`保存关联工作流失败（HTTP ${res.status}）`);
    }
    const updated = (await res.json()) as WorkflowDef;
    setWorkflowDef(updated);
    setWorkflows((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  }, [agentNodeIndex, workflowDef]);

  const agentParamsPatch = useMemo(() => {
    const parsedTools = agentTools
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const enforcePureAgentDefaults = workflowDef.id === FALLBACK_WORKFLOW.id && agentNodeType === 'agent_react';
    const tools = enforcePureAgentDefaults ? REACT_DEFAULT_TOOLS.split(',') : parsedTools;
    const maxTurns = enforcePureAgentDefaults
      ? REACT_DEFAULT_MAX_TURNS
      : Math.max(1, Math.min(12, agentMaxTurns));
    if (agentNodeType === 'agent_react') {
      return {
        llmProvider,
        llmModel,
        llmBaseUrl,
        llmApiKeyEnv,
        llmTemperature: 0.2,
        systemPrompt: llmSystemPrompt,
        userPromptTemplate: llmUserPromptTemplate,
        tools,
        maxTurns,
      };
    }
    return {
      llmProvider,
      llmModel,
      llmBaseUrl,
      llmApiKeyEnv,
      llmTemperature: 0.2,
      llmSystemPrompt,
      llmUserPromptTemplate,
      tools,
      maxTurns,
    };
  }, [
    workflowDef.id,
    agentMaxTurns,
    agentNodeType,
    agentTools,
    llmApiKeyEnv,
    llmBaseUrl,
    llmModel,
    llmProvider,
    llmSystemPrompt,
    llmUserPromptTemplate,
  ]);

  useEffect(() => {
    if (!initializedRef.current) return;
    if (!workflowDef?.id) return;
    const timer = window.setTimeout(() => {
      setSavingWorkflow(true);
      setSaveHint('正在同步到关联工作流...');
      void persistWorkflowPatch(agentParamsPatch)
        .then(() => setSaveHint('已同步到关联工作流'))
        .catch((e) => setSaveHint(e instanceof Error ? e.message : String(e)))
        .finally(() => setSavingWorkflow(false));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [agentParamsPatch, persistWorkflowPatch, workflowDef.id]);

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
    setTopicDetail(null);
    setLogs([]);
    setSessionId('');

    try {
      pushLog('🚀 准备工作流...');
      const runtimeWorkflow = buildRuntimeWorkflow(workflowDef, agentNodeIndex, {
        ...agentParamsPatch,
        llmProvider,
        llmModel,
        llmBaseUrl,
        llmApiKeyEnv,
        llmApiKey: llmApiKey.trim() || undefined,
        llmSystemPrompt, // 兼容旧节点参数名
        llmUserPromptTemplate, // 兼容旧节点参数名
      });
      pushLog(`🧩 当前工作流: ${runtimeWorkflow.name} (${runtimeWorkflow.id})`);
      pushLog(`🧩 关联 Agent 节点: #${agentNodeIndex + 1} (${agentNodeType})`);

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
      pushLog(`  - llm = ${llmProvider}/${llmModel}`);
      pushLog(`  - llmBaseUrl = ${llmBaseUrl}`);
      pushLog(`  - llmApiKeyEnv = ${llmApiKeyEnv}`);
      pushLog(`  - llmApiKey = ${llmApiKey.trim() ? '已填写（优先）' : '未填写（走环境变量）'}`);
      pushLog(`  - tools = ${agentTools || '(none)'}`);

      const sessionRes = await fetch('/api/workflow/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: runtimeWorkflow, vars }),
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
        const detail =
          parseTopicIdeasDetail(step.output?.topicIdeasDetail) ??
          parseTopicIdeasDetail(step.vars?.topicIdeasDetail);
        if (detail) setTopicDetail(detail);
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
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">关联工作流</label>
            <select
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
              disabled={loadingWorkflow || running}
            >
              {workflows.length === 0 && <option value={workflowDef.id}>{workflowDef.name}</option>}
              {workflows.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.name} ({wf.id})
                </option>
              ))}
            </select>
          </div>
          <div className="text-xs text-muted-foreground rounded-lg border border-border px-3 py-2 bg-background">
            <div>
              Agent 节点：#{agentNodeIndex + 1} · {agentNodeType} · {workflowDef.nodes[agentNodeIndex]?.label ?? '(未命名)'}
            </div>
            <div className="mt-1">同步状态：{savingWorkflow ? '保存中...' : saveHint || '已加载'}</div>
          </div>
        </div>
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
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Agent 工具（逗号分隔）</label>
            <input
              value={agentTools}
              onChange={(e) => setAgentTools(e.target.value)}
              className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
              placeholder="dailyhot.fetch_topics,topic.evaluate_candidates"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Agent 最大回合数</label>
            <input
              type="number"
              min={1}
              max={12}
              value={agentMaxTurns}
              onChange={(e) => setAgentMaxTurns(Number(e.target.value) || 1)}
              className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">LLM Provider</label>
            <select
              value={llmProvider}
              onChange={(e) => setLlmProvider(e.target.value)}
              className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
            >
              <option value="qianwen">qianwen</option>
              <option value="openai">openai</option>
              <option value="gemini">gemini</option>
              <option value="deepseek">deepseek</option>
              <option value="auto">auto</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">LLM Model</label>
            <input
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
              placeholder="qwen-turbo"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">LLM Base URL</label>
            <input
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
              placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">LLM API Key Env</label>
            <input
              value={llmApiKeyEnv}
              onChange={(e) => setLlmApiKeyEnv(e.target.value)}
              className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
              placeholder="QWEN_API_KEY"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-muted-foreground mb-1">LLM API Key（可选，优先于环境变量）</label>
            <input
              type="password"
              value={llmApiKey}
              onChange={(e) => setLlmApiKey(e.target.value)}
              className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
              placeholder="sk-..."
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">系统提示词（工作流 agent 节点）</label>
          <textarea
            value={llmSystemPrompt}
            onChange={(e) => setLlmSystemPrompt(e.target.value)}
            rows={3}
            className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm resize-y"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">用户提示词模板（工作流 agent 节点）</label>
          <textarea
            value={llmUserPromptTemplate}
            onChange={(e) => setLlmUserPromptTemplate(e.target.value)}
            rows={5}
            className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm resize-y"
          />
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
          {topicDetail?.llm && (
            <div className="mb-3 text-xs text-muted-foreground">
              模型：{topicDetail.llm.provider}/{topicDetail.llm.model} · {topicDetail.llm.baseUrl}
            </div>
          )}
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

      <div className="bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">平台热门数据</h2>
        <div className="space-y-4 max-h-[460px] overflow-auto">
          {(topicDetail?.fetch?.stats?.length ?? 0) > 0 && (
            <div className="text-xs text-muted-foreground space-y-1">
              {topicDetail?.fetch?.stats?.map((stat) => (
                <div key={stat.source}>
                  {stat.sourceName ?? stat.source}（{stat.source}）：{stat.status} · {stat.itemCount} 条
                  {stat.httpStatus ? ` · HTTP ${stat.httpStatus}` : ''}
                  {stat.error ? ` · ${stat.error}` : ''}
                </div>
              ))}
            </div>
          )}
          {(topicDetail?.fetch?.topicLists?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground">暂无平台热门数据</div>
          ) : (
            topicDetail?.fetch?.topicLists?.map((list) => (
              <div key={list.source} className="border border-border rounded-lg p-3 space-y-2">
                <div className="text-sm font-medium">
                  {list.sourceName} ({list.source})
                </div>
                <div className="space-y-1">
                  {list.items.map((item) => (
                    <div key={item.id} className="text-xs text-muted-foreground">
                      {item.rank}. {item.title}
                      {typeof item.hotValue === 'number' ? ` · 热度 ${item.hotValue}` : ''}
                      {item.url ? (
                        <>
                          {' · '}
                          <a href={item.url} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">
                            链接
                          </a>
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
