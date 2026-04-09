import type { Page } from 'playwright';
import { existsSync, readFileSync } from 'fs';
import type { NodeResult, TopicPickerAgentParams, WorkflowContext } from '../types';
import { fetchDailyHotTopics } from '../skills/dailyhot-topic-skill';
import { evaluateTopicCandidates } from '../skills/topic-evaluator-skill';
import type { TopicCandidate } from '../topic-evaluators';

const DEFAULT_SOURCES = ['douyin', 'bilibili', 'baidu', 'toutiao', 'thepaper'];

interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
type LlmProvider = 'openai' | 'gemini' | 'qianwen' | 'deepseek';

interface LlmToolCall {
  name: 'dailyhot.fetch_topics' | 'evaluator.score_candidates';
  arguments?: Record<string, unknown>;
}

interface LlmPlannerResult {
  toolCalls: LlmToolCall[];
}

interface LlmFinalResult {
  selected: Array<{
    rank?: number;
    title: string;
    source?: string;
    sourceName?: string;
    score: number;
    reason: string;
    expected?: { exposure?: number; plays?: number; fans?: number };
    url?: string;
  }>;
  summary?: string;
  discarded?: Array<{ title: string; reason: string }>;
}

function parseSources(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((item) => String(item).trim()).filter(Boolean);
  const text = String(raw ?? '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
    } catch {
      // fallback
    }
  }
  return text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function normalizeTitle(title: string) {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function buildDiscussScore(title: string) {
  let score = 35;
  if (/[？?！!]/.test(title)) score += 12;
  if (/(如何|怎么|为什么|真相|内幕|避坑|教程|攻略|测评|曝光|官方|首发)/.test(title)) score += 20;
  if (title.length >= 12) score += 8;
  if (title.length >= 20) score += 6;
  return Math.max(0, Math.min(100, score));
}

function buildActionabilityScore(title: string) {
  let score = 30;
  if (/(教程|攻略|清单|方法|步骤|技巧|模板|指南|盘点|推荐|测评|对比)/.test(title)) score += 35;
  if (/(突发|刚刚|快讯|官宣|回应|发布)/.test(title)) score += 10;
  if (/(抽象|玄学|无语|离谱)/.test(title)) score -= 8;
  return Math.max(0, Math.min(100, score));
}

function buildTimelinessScore(timestamp: number | undefined) {
  if (!timestamp || !Number.isFinite(timestamp)) return 45;
  const hours = (Date.now() - timestamp) / (1000 * 60 * 60);
  if (hours <= 2) return 100;
  if (hours <= 6) return 90;
  if (hours <= 12) return 75;
  if (hours <= 24) return 60;
  if (hours <= 48) return 45;
  return 30;
}

function toCandidates(items: Awaited<ReturnType<typeof fetchDailyHotTopics>>['topics']): TopicCandidate[] {
  const grouped = new Map<string, number>();
  for (const item of items) {
    const currentMax = grouped.get(item.source) ?? 0;
    grouped.set(item.source, Math.max(currentMax, item.hotValue ?? 0));
  }
  return items.map((item) => {
    const sourceMax = grouped.get(item.source) ?? 0;
    const hotByRank = Math.max(0, 100 - (item.rank - 1) * 4);
    const hotByValue = sourceMax > 0 && item.hotValue ? (item.hotValue / sourceMax) * 100 : hotByRank;
    const hotScore = Math.max(hotByRank * 0.45 + hotByValue * 0.55, 0);
    const trendScore = Math.max(20, 100 - (item.rank - 1) * 5);
    return {
      id: item.id,
      title: item.title,
      source: item.source,
      sourceName: item.sourceName,
      url: item.url,
      hotValue: item.hotValue,
      rank: item.rank,
      timestamp: item.timestamp,
      hotScore: Math.min(100, hotScore),
      trendScore: Math.min(100, trendScore),
      discussScore: buildDiscussScore(item.title),
      actionabilityScore: buildActionabilityScore(item.title),
      timelinessScore: buildTimelinessScore(item.timestamp),
    };
  });
}

function dedupeByTitle<T extends { title: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = normalizeTitle(item.title);
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function parseJsonObject<T>(raw: string): T {
  const text = raw.trim();
  const obj = text.startsWith('```')
    ? text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
    : text;
  return JSON.parse(obj) as T;
}

function extractAssistantContent(payload: unknown): string {
  const data = payload as {
    choices?: Array<{
      message?: { content?: string | Array<{ type?: string; text?: string }> };
    }>;
  };
  const first = data.choices?.[0]?.message?.content;
  if (typeof first === 'string') return first;
  if (Array.isArray(first)) {
    return first
      .map((item) => (typeof item?.text === 'string' ? item.text : ''))
      .join('')
      .trim();
  }
  return '';
}

function resolveLlmConfig(params: TopicPickerAgentParams, ctx: WorkflowContext) {
  const readSecretFromFile = (key: string) => {
    const file = '/root/.config/openclaw/secrets.env';
    if (!existsSync(file)) return '';
    const text = readFileSync(file, 'utf-8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith(`${key}=`)) continue;
      return trimmed.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '');
    }
    return '';
  };

  const providerRaw = String(
    params.llmProvider ??
      ctx.vars.topicLlmProvider ??
      process.env.TOPIC_AGENT_PROVIDER ??
      'auto'
  )
    .trim()
    .toLowerCase();
  const provider: LlmProvider =
    providerRaw === 'gemini' || providerRaw === 'qianwen' || providerRaw === 'deepseek' || providerRaw === 'openai'
      ? providerRaw
      : providerRaw === 'auto'
        ? 'qianwen'
        : 'openai';

  const defaultModelByProvider: Record<LlmProvider, string> = {
    openai: 'gpt-4.1',
    gemini: 'gemini-2.5-flash',
    qianwen: 'qwen-plus',
    deepseek: 'deepseek-chat',
  };
  const defaultBaseUrlByProvider: Record<LlmProvider, string> = {
    openai: 'https://api.openai.com/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta',
    qianwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    deepseek: 'https://api.deepseek.com/v1',
  };
  const defaultKeyEnvByProvider: Record<LlmProvider, string> = {
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
    qianwen: 'QWEN_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
  };

  const model = String(params.llmModel ?? ctx.vars.topicLlmModel ?? process.env.TOPIC_AGENT_MODEL ?? defaultModelByProvider[provider]).trim();
  const openaiBase = provider === 'openai' ? process.env.OPENAI_BASE_URL : undefined;
  const baseUrl = String(
    params.llmBaseUrl ??
      ctx.vars.topicLlmBaseUrl ??
      process.env.TOPIC_AGENT_BASE_URL ??
      openaiBase ??
      defaultBaseUrlByProvider[provider]
  ).replace(/\/+$/, '');
  const keyEnv = String(
    params.llmApiKeyEnv ??
      ctx.vars.topicLlmApiKeyEnv ??
      process.env.TOPIC_AGENT_API_KEY_ENV ??
      defaultKeyEnvByProvider[provider]
  ).trim();
  const envKey = keyEnv ? process.env[keyEnv] : undefined;
  const apiKey =
    String(params.llmApiKey ?? '').trim() ||
    String(ctx.vars.topicLlmApiKey ?? '').trim() ||
    String(envKey ?? '').trim() ||
    String(process.env.TOPIC_AGENT_API_KEY ?? '').trim() ||
    String(process.env.OPENAI_API_KEY ?? '').trim() ||
    String(process.env.GEMINI_API_KEY ?? '').trim() ||
    String(process.env.QWEN_API_KEY ?? '').trim() ||
    String(process.env.DEEPSEEK_API_KEY ?? '').trim() ||
    String(process.env.GROK_API_KEY ?? '').trim() ||
    readSecretFromFile(keyEnv || 'OPENAI_API_KEY') ||
    readSecretFromFile('TOPIC_AGENT_API_KEY') ||
    readSecretFromFile('OPENAI_API_KEY') ||
    readSecretFromFile('GEMINI_API_KEY') ||
    readSecretFromFile('QWEN_API_KEY') ||
    readSecretFromFile('DEEPSEEK_API_KEY');
  const temperatureRaw = Number(params.llmTemperature ?? 0.2);
  const temperature = Number.isFinite(temperatureRaw) ? Math.max(0, Math.min(1, temperatureRaw)) : 0.2;

  if (!apiKey) {
    throw new Error(`缺少 ${keyEnv}（或节点参数 llmApiKey）`);
  }
  return { provider, model, baseUrl, apiKey, temperature };
}

async function callLlmOpenAICompatible(
  config: { model: string; baseUrl: string; apiKey: string; temperature: number },
  messages: LlmMessage[]
) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      messages,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`LLM 请求失败（HTTP ${response.status}）：${text.slice(0, 240)}`);
  }
  const payload = JSON.parse(text) as unknown;
  const content = extractAssistantContent(payload);
  if (!content) throw new Error('LLM 未返回可解析内容');
  return content;
}

async function callLlmGemini(
  config: { model: string; baseUrl: string; apiKey: string; temperature: number },
  messages: LlmMessage[]
) {
  const systemInstruction = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const contents = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: '请输出 JSON。' }] });
  }

  const endpoint = `${config.baseUrl}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
      contents,
      generationConfig: { temperature: config.temperature },
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini 请求失败（HTTP ${response.status}）：${text.slice(0, 240)}`);
  }
  const payload = JSON.parse(text) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const output =
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim() || '';
  if (!output) throw new Error('Gemini 未返回可解析内容');
  return output;
}

async function callLlm(
  config: { provider: LlmProvider; model: string; baseUrl: string; apiKey: string; temperature: number },
  messages: LlmMessage[]
) {
  if (config.provider === 'gemini') return callLlmGemini(config, messages);
  return callLlmOpenAICompatible(config, messages);
}

function fallbackFromEvaluator(args: {
  goal: string;
  count: number;
  scored: ReturnType<typeof evaluateTopicCandidates>['scored'];
  evaluator: ReturnType<typeof evaluateTopicCandidates>['evaluator'];
}) {
  const selected = args.scored.slice(0, args.count).map((item, index) => ({
    rank: index + 1,
    title: item.title,
    source: item.source,
    sourceName: item.sourceName,
    score: Number(item.score.toFixed(2)),
    reason: item.reason,
    expected: item.expected,
    url: item.url ?? '',
  }));
  return {
    selected,
    summary: `LLM 输出不可用，使用 ${args.evaluator.id}@${args.evaluator.version} 稳定回退`,
    discarded: [],
  };
}

function normalizeFinalResult(
  raw: LlmFinalResult,
  count: number,
  candidates: TopicCandidate[],
  defaultReason: string
) {
  const candidateByTitle = new Map(candidates.map((item) => [normalizeTitle(item.title), item]));
  const seen = new Set<string>();
  const selected = (Array.isArray(raw.selected) ? raw.selected : [])
    .map((item) => {
      const title = String(item.title ?? '').trim();
      if (!title) return null;
      const key = normalizeTitle(title);
      const base = key ? candidateByTitle.get(key) : undefined;
      const score = Number(item.score);
      const expected = item.expected ?? {};
      return {
        rank: Number(item.rank) > 0 ? Number(item.rank) : 0,
        title,
        source: String(item.source ?? base?.source ?? ''),
        sourceName: String(item.sourceName ?? base?.sourceName ?? item.source ?? ''),
        score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
        reason: String(item.reason ?? defaultReason).trim() || defaultReason,
        expected: {
          exposure: Number(expected.exposure ?? 0) || 0,
          plays: Number(expected.plays ?? 0) || 0,
          fans: Number(expected.fans ?? 0) || 0,
        },
        url: String(item.url ?? base?.url ?? ''),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => {
      const key = normalizeTitle(item.title);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, count)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return selected;
}

function enforceSourceDiversity(args: {
  selected: Array<{
    rank: number;
    title: string;
    source: string;
    sourceName: string;
    score: number;
    reason: string;
    expected: { exposure: number; plays: number; fans: number };
    url: string;
  }>;
  scored: ReturnType<typeof evaluateTopicCandidates>['scored'];
  count: number;
}) {
  const selected = args.selected;
  const availableSources = new Set(args.scored.map((item) => item.source).filter(Boolean));
  if (selected.length === 0 || availableSources.size < 2) {
    return { selected, adjusted: false, requiredUniqueSources: 1 };
  }

  const requiredUniqueSources = Math.min(args.count, availableSources.size, 3);
  const currentUniqueSources = new Set(selected.map((item) => item.source).filter(Boolean));
  if (currentUniqueSources.size >= requiredUniqueSources) {
    return { selected, adjusted: false, requiredUniqueSources };
  }

  const selectedTitleSet = new Set(selected.map((item) => normalizeTitle(item.title)));
  const pool = args.scored
    .map((item) => ({
      rank: 0,
      title: item.title,
      source: item.source,
      sourceName: item.sourceName,
      score: Number(item.score.toFixed(2)),
      reason: item.reason,
      expected: item.expected,
      url: item.url ?? '',
    }))
    .filter((item) => !selectedTitleSet.has(normalizeTitle(item.title)));

  const combined = [...selected, ...pool];
  const output: typeof selected = [];
  const outputTitles = new Set<string>();
  const outputSources = new Set<string>();

  for (const item of combined) {
    if (output.length >= args.count) break;
    const key = normalizeTitle(item.title);
    if (!key || outputTitles.has(key)) continue;
    if (outputSources.size < requiredUniqueSources && !outputSources.has(item.source)) {
      output.push(item);
      outputTitles.add(key);
      if (item.source) outputSources.add(item.source);
    }
  }

  for (const item of combined) {
    if (output.length >= args.count) break;
    const key = normalizeTitle(item.title);
    if (!key || outputTitles.has(key)) continue;
    output.push(item);
    outputTitles.add(key);
    if (item.source) outputSources.add(item.source);
  }

  const finalized = output
    .slice(0, args.count)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const adjusted = finalized.length > 0 && new Set(finalized.map((item) => item.source).filter(Boolean)).size >= 2;
  return { selected: finalized, adjusted, requiredUniqueSources };
}

export async function executeTopicPickerAgent(
  _page: Page,
  params: TopicPickerAgentParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  const goal = String(params.goal ?? ctx.vars.goal ?? '给我当前最具价值的三个选题').trim();
  const count = Math.max(3, Math.min(5, Number(params.count ?? ctx.vars.count ?? 3) || 3));
  const baseUrl = String(params.baseUrl ?? ctx.vars.dailyHotApiBaseUrl ?? 'https://dailyhotapi-hazel.vercel.app').trim();
  const perSourceLimit = Math.max(5, Math.min(30, Number(params.perSourceLimit ?? 20) || 20));
  const sources = parseSources(params.sources).length > 0 ? parseSources(params.sources) : DEFAULT_SOURCES;
  const outputVar = String(params.outputVar ?? 'topicIdeas').trim() || 'topicIdeas';
  const outputDetailVar = String(params.outputDetailVar ?? 'topicIdeasDetail').trim() || 'topicIdeasDetail';
  const evaluatorId = String(params.evaluatorId ?? '').trim() || undefined;

  try {
    const llmConfig = resolveLlmConfig(params, ctx);
    log.push(`🎯 目标：${goal}`);
    log.push(`🧠 LLM：${llmConfig.provider}/${llmConfig.model} @ ${llmConfig.baseUrl}`);
    log.push(`🧰 Skills：dailyhot.fetch_topics + evaluator.score_candidates`);
    log.push(`📡 来源：${sources.join(', ')}`);

    const fetched = await fetchDailyHotTopics({ baseUrl, sources, perSourceLimit });
    log.push(
      `🧪 DailyHot 健康检查：请求 ${sources.length} 个来源，/all 可用 ${fetched.availableSources.length}，下线 ${fetched.disabledSources.length}`
    );
    for (const stat of fetched.stats) {
      if (stat.status === 'ok') {
        log.push(`  ✅ ${stat.source}${stat.sourceName ? `（${stat.sourceName}）` : ''}：${stat.itemCount} 条`);
      } else {
        const detail = [stat.status, stat.httpStatus ? `HTTP ${stat.httpStatus}` : '', stat.error ?? '']
          .filter(Boolean)
          .join(' / ');
        log.push(`  ⚠️ ${stat.source}：${detail}`);
      }
    }
    log.push(`✅ 有效来源：${fetched.enabledSources.join(', ') || '无'}`);
    const candidates = dedupeByTitle(toCandidates(fetched.topics));
    if (candidates.length === 0) throw new Error('候选选题为空，无法继续');
    log.push(`📥 候选选题：${candidates.length} 条`);
    const perSourceCounts = new Map<string, number>();
    for (const candidate of candidates) {
      perSourceCounts.set(candidate.source, (perSourceCounts.get(candidate.source) ?? 0) + 1);
    }
    const sourceSummary = Array.from(perSourceCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([source, size]) => `${source}:${size}`)
      .join(', ');
    log.push(`📊 候选分布：${sourceSummary}`);

    const plannerPrompt: LlmMessage[] = [
      {
        role: 'system',
        content:
          '你是选题Agent的规划器。你必须输出JSON对象，不要输出其他文本。可用工具: dailyhot.fetch_topics, evaluator.score_candidates。' +
          '如果已经有候选数据，优先调用 evaluator.score_candidates。返回格式: {"toolCalls":[{"name":"...","arguments":{}}]}',
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            goal,
            count,
            availableTools: ['dailyhot.fetch_topics', 'evaluator.score_candidates'],
            candidatePreview: candidates.slice(0, 12).map((item) => ({
              title: item.title,
              source: item.source,
              hotScore: Number(item.hotScore.toFixed(1)),
              trendScore: Number(item.trendScore.toFixed(1)),
            })),
          },
          null,
          2
        ),
      },
    ];

    let planner: LlmPlannerResult = { toolCalls: [{ name: 'evaluator.score_candidates', arguments: {} }] };
    try {
      const plannerRaw = await callLlm(llmConfig, plannerPrompt);
      planner = parseJsonObject<LlmPlannerResult>(plannerRaw);
    } catch {
      // keep safe default
    }
    const plannerText = (planner.toolCalls ?? [])
      .map((call) => `${call.name}${call.arguments ? `(${JSON.stringify(call.arguments)})` : ''}`)
      .join(' -> ');
    log.push(`🤖 Planner 工具计划：${plannerText || 'evaluator.score_candidates(默认回退)'}`);

    const toolCalls = Array.isArray(planner.toolCalls) ? planner.toolCalls : [];
    const shouldRunEvaluator =
      toolCalls.length === 0 || toolCalls.some((call) => call.name === 'evaluator.score_candidates');

    const evaluated = evaluateTopicCandidates({
      candidates,
      goal,
      evaluatorId: shouldRunEvaluator
        ? String(toolCalls.find((call) => call.name === 'evaluator.score_candidates')?.arguments?.evaluatorId ?? evaluatorId ?? '')
        : evaluatorId,
    });
    log.push(`🧪 评估器：${evaluated.evaluator.id}@${evaluated.evaluator.version}（${evaluated.evaluator.label}）`);
    for (const [index, item] of evaluated.scored.slice(0, Math.min(5, count + 2)).entries()) {
      log.push(`  #${index + 1} ${item.title}（${item.sourceName}）score=${item.score.toFixed(2)}`);
    }

    const finalPrompt: LlmMessage[] = [
      {
        role: 'system',
        content:
          '你是选题评审Agent。请严格输出JSON对象，字段仅允许：selected, summary, discarded。' +
          `selected 必须是 ${count} 条（若不够可少，但尽量满足），每条包含 title/source/sourceName/score/reason/expected/url。` +
          'score 范围0-100，expected包含 exposure/plays/fans 三个整数。',
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            goal,
            count,
            candidateCount: candidates.length,
            scoredTop: evaluated.scored.slice(0, 20).map((item, index) => ({
              rank: index + 1,
              title: item.title,
              source: item.source,
              sourceName: item.sourceName,
              score: Number(item.score.toFixed(2)),
              reason: item.reason,
              expected: item.expected,
              url: item.url ?? '',
            })),
            instruction:
              '基于上述候选与评分，给出最终3-5条选题。允许你根据目标重排，但必须解释原因，并输出结构化JSON。',
          },
          null,
          2
        ),
      },
    ];

    let llmFinal: LlmFinalResult | null = null;
    try {
      const finalRaw = await callLlm(llmConfig, finalPrompt);
      llmFinal = parseJsonObject<LlmFinalResult>(finalRaw);
    } catch (error) {
      log.push(`⚠️ LLM 最终输出解析失败，已回退到评估器结果：${error instanceof Error ? error.message : String(error)}`);
    }

    const fallback = fallbackFromEvaluator({
      goal,
      count,
      scored: evaluated.scored,
      evaluator: evaluated.evaluator,
    });
    const selected = llmFinal
      ? normalizeFinalResult(llmFinal, count, candidates, fallback.summary)
      : fallback.selected;
    const preFinalSelected = selected.length > 0 ? selected : fallback.selected;
    const diversityAdjusted = enforceSourceDiversity({
      selected: preFinalSelected,
      scored: evaluated.scored,
      count,
    });
    const finalSelected = diversityAdjusted.selected;
    if (diversityAdjusted.adjusted) {
      log.push(`⚖️ 已执行多源平衡：至少覆盖 ${diversityAdjusted.requiredUniqueSources} 个来源（避免结果被单一来源垄断）`);
    }
    const selectedSourceSummary = Array.from(
      finalSelected.reduce((map, item) => map.set(item.source, (map.get(item.source) ?? 0) + 1), new Map<string, number>())
    )
      .map(([source, size]) => `${source}:${size}`)
      .join(', ');
    log.push(`📌 最终来源分布：${selectedSourceSummary}`);

    const detail = {
      goal,
      llm: { provider: llmConfig.provider, model: llmConfig.model, baseUrl: llmConfig.baseUrl },
      evaluator: evaluated.evaluator,
      sourceCount: fetched.enabledSources.length,
      candidateCount: candidates.length,
      selectedCount: finalSelected.length,
      generatedAt: new Date().toISOString(),
      summary: llmFinal?.summary ?? fallback.summary,
      discarded: llmFinal?.discarded ?? [],
      selected: finalSelected,
    };

    ctx.vars[outputVar] = JSON.stringify(finalSelected);
    ctx.vars[outputDetailVar] = JSON.stringify(detail);
    log.push(`✅ 已产出 ${finalSelected.length} 个选题`);
    for (const topic of finalSelected) {
      log.push(`  ${topic.rank}. ${topic.title}（${topic.sourceName}）score=${topic.score}`);
    }

    return {
      success: true,
      log,
      output: {
        [outputVar]: finalSelected,
        [outputDetailVar]: detail,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.push(`❌ 选题节点失败：${message}`);
    return { success: false, log, error: message };
  }
}
