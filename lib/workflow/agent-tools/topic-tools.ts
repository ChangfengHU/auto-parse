import { fetchDailyHotTopics } from '../skills/dailyhot-topic-skill';
import { evaluateTopicCandidates } from '../skills/topic-evaluator-skill';
import type { TopicCandidate } from '../topic-evaluators';
import type { WorkflowContext } from '../types';
import { registerAgentTool } from './registry';

let registered = false;

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

function dedupeByTitle<T extends { title: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = normalizeTitle(item.title);
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
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

function buildSourceTopicLists(items: Awaited<ReturnType<typeof fetchDailyHotTopics>>['topics']) {
  const grouped = new Map<
    string,
    {
      source: string;
      sourceName: string;
      items: Array<{
        id: string;
        title: string;
        rank: number;
        hotValue?: number;
        timestamp?: number;
        url?: string;
      }>;
    }
  >();
  for (const item of items) {
    const key = item.source;
    const entry = grouped.get(key) ?? {
      source: item.source,
      sourceName: item.sourceName,
      items: [],
    };
    entry.items.push({
      id: item.id,
      title: item.title,
      rank: item.rank,
      hotValue: item.hotValue,
      timestamp: item.timestamp,
      url: item.url,
    });
    grouped.set(key, entry);
  }
  return Array.from(grouped.values()).sort((a, b) => a.source.localeCompare(b.source));
}

function readGoal(input: unknown, ctx: WorkflowContext) {
  if (typeof input === 'object' && input && 'goal' in input) {
    const goal = String((input as { goal?: unknown }).goal ?? '').trim();
    if (goal) return goal;
  }
  return String(ctx.vars.goal ?? '').trim() || '给我当前最具价值的三个选题';
}

export function registerTopicAgentTools(): void {
  if (registered) return;
  registered = true;

  registerAgentTool({
    name: 'dailyhot.fetch_topics',
    description: '拉取 DailyHot 热点候选并返回来源健康检查结果。',
    inputSchema:
      '{"type":"object","properties":{"baseUrl":{"type":"string"},"sources":{"type":"array","items":{"type":"string"}},"perSourceLimit":{"type":"number"}}}',
    async execute(input, _ctx) {
      const payload = (input && typeof input === 'object' ? input : {}) as {
        baseUrl?: unknown;
        sources?: unknown;
        perSourceLimit?: unknown;
      };
      const configuredBaseUrlRaw = String(_ctx.vars.dailyHotApiBaseUrl ?? 'https://dailyhotapi-hazel.vercel.app').trim();
      const configuredBaseUrl = configuredBaseUrlRaw || 'https://dailyhotapi-hazel.vercel.app';
      const requestedBaseUrl = String(payload.baseUrl ?? '').trim();
      let baseUrl = requestedBaseUrl || configuredBaseUrl;
      try {
        const configuredHost = new URL(configuredBaseUrl).hostname;
        const requestedHost = new URL(baseUrl).hostname;
        if (requestedHost !== configuredHost) {
          baseUrl = configuredBaseUrl;
        }
      } catch {
        baseUrl = configuredBaseUrl;
      }
      const sources = parseSources(payload.sources);
      if (sources.length === 0) {
        throw new Error('dailyhot.fetch_topics 缺少 sources');
      }
      const perSourceLimitRaw = Number(payload.perSourceLimit ?? 20);
      const perSourceLimit = Number.isFinite(perSourceLimitRaw)
        ? Math.max(5, Math.min(30, Math.floor(perSourceLimitRaw)))
        : 20;
      const fetched = await fetchDailyHotTopics({ baseUrl, sources, perSourceLimit });
      const candidates = dedupeByTitle(
        fetched.topics.map((item, index) => ({
          rank: index + 1,
          title: item.title,
          source: item.source,
          sourceName: item.sourceName,
          hotValue: item.hotValue ?? null,
          sourceRank: item.rank,
          timestamp: item.timestamp ?? null,
          url: item.url ?? '',
        }))
      );
      return {
        candidateCount: candidates.length,
        candidates,
        fetch: {
          baseUrl,
          requestedSources: sources,
          availableSources: fetched.availableSources,
          enabledSources: fetched.enabledSources,
          disabledSources: fetched.disabledSources,
          stats: fetched.stats,
          topicLists: buildSourceTopicLists(fetched.topics),
        },
      };
    },
  });

  registerAgentTool({
    name: 'topic.evaluate_candidates',
    description: '对候选选题进行可执行性/热度综合评分并返回排序结果。',
    inputSchema:
      '{"type":"object","properties":{"goal":{"type":"string"},"evaluatorId":{"type":"string"},"candidates":{"type":"array"},"count":{"type":"number"}}}',
    async execute(input, ctx) {
      const payload = (input && typeof input === 'object' ? input : {}) as {
        candidates?: unknown;
        goal?: unknown;
        evaluatorId?: unknown;
        count?: unknown;
      };
      const goal = readGoal(payload, ctx);
      const evaluatorId = String(payload.evaluatorId ?? '').trim() || undefined;
      if (!Array.isArray(payload.candidates)) {
        throw new Error('topic.evaluate_candidates 缺少 candidates 数组');
      }
      const rawCandidates = payload.candidates as Array<{
        title?: unknown;
        source?: unknown;
        sourceName?: unknown;
        url?: unknown;
        sourceRank?: unknown;
        hotValue?: unknown;
        timestamp?: unknown;
      }>;
      const normalized = rawCandidates
        .map((item, index) => ({
          id: `${String(item.source ?? 'unknown')}-${index + 1}`,
          title: String(item.title ?? '').trim(),
          source: String(item.source ?? '').trim(),
          sourceName: String(item.sourceName ?? item.source ?? '').trim(),
          url: String(item.url ?? '').trim(),
          hotValue: Number(item.hotValue ?? 0) || undefined,
          rank: Number(item.sourceRank ?? index + 1) || index + 1,
          timestamp: Number(item.timestamp ?? 0) || undefined,
        }))
        .filter((item) => item.title && item.source);
      if (normalized.length === 0) {
        throw new Error('topic.evaluate_candidates 的 candidates 为空');
      }
      const evaluated = evaluateTopicCandidates({
        candidates: toCandidates(normalized),
        goal,
        evaluatorId,
      });
      const countRaw = Number(payload.count ?? 5);
      const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(20, Math.floor(countRaw))) : 5;
      return {
        evaluator: evaluated.evaluator,
        count,
        scored: evaluated.scored.slice(0, Math.max(count * 3, 20)).map((item, index) => ({
          rank: index + 1,
          title: item.title,
          source: item.source,
          sourceName: item.sourceName,
          score: Number(item.score.toFixed(2)),
          reason: item.reason,
          expected: item.expected,
          url: item.url ?? '',
        })),
      };
    },
  });
}
