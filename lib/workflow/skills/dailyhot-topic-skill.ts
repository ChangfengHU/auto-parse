interface DailyHotAllResponse {
  routes?: Array<{ name?: string; path?: string | null }>;
}

interface DailyHotListItem {
  id?: string | number;
  title?: string;
  timestamp?: number;
  hot?: number | string;
  url?: string;
}

interface DailyHotListResponse {
  name?: string;
  title?: string;
  data?: DailyHotListItem[];
}

type SourceFetchStatus = 'ok' | 'unsupported' | 'disabled' | 'failed';

export interface DailyHotSourceStat {
  source: string;
  status: SourceFetchStatus;
  itemCount: number;
  sourceName?: string;
  httpStatus?: number;
  error?: string;
}

export interface DailyHotTopicItem {
  id: string;
  title: string;
  source: string;
  sourceName: string;
  url?: string;
  timestamp?: number;
  hotValue?: number;
  rank: number;
}

export interface DailyHotSkillInput {
  baseUrl: string;
  sources: string[];
  perSourceLimit: number;
}

// 这些来源当前在生产 API 上长期报错或不可访问，先下线避免误导用户。
const DISABLED_SOURCES = new Set(['52pojie', 'coolapk', 'earthquake', 'hostloc', 'huxiu', 'weibo', 'zhihu']);

function cleanBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

function parseHot(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const n = Number(value.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export async function fetchDailyHotTopics(input: DailyHotSkillInput): Promise<{
  topics: DailyHotTopicItem[];
  enabledSources: string[];
  stats: DailyHotSourceStat[];
  availableSources: string[];
  disabledSources: string[];
}> {
  const baseUrl = cleanBaseUrl(input.baseUrl);
  const allRes = await fetch(`${baseUrl}/all`, { cache: 'no-store' });
  if (!allRes.ok) {
    throw new Error(`DailyHotApi /all 请求失败（HTTP ${allRes.status}）`);
  }
  const allData = (await allRes.json()) as DailyHotAllResponse;
  const availableSources = (allData.routes ?? [])
    .filter((route) => route.path)
    .map((route) => String(route.name ?? '').trim())
    .filter(Boolean);
  const available = new Set(availableSources);
  const requestedSources = Array.from(new Set(input.sources.map((source) => String(source).trim()).filter(Boolean)));
  const stats: DailyHotSourceStat[] = [];

  const unsupportedSources = requestedSources.filter((source) => !available.has(source));
  for (const source of unsupportedSources) {
    stats.push({
      source,
      status: 'unsupported',
      itemCount: 0,
      error: '不在 /all 可用来源列表中',
    });
  }

  const disabledRequested = requestedSources.filter((source) => DISABLED_SOURCES.has(source));
  for (const source of disabledRequested) {
    stats.push({
      source,
      status: 'disabled',
      itemCount: 0,
      error: '该来源当前不稳定，已下线',
    });
  }

  const enabledSources = requestedSources.filter(
    (source) => available.has(source) && !DISABLED_SOURCES.has(source)
  );
  if (enabledSources.length === 0) {
    throw new Error('未匹配到可用来源（可能都被下线或不可用），请检查 sources 配置');
  }

  const results = await Promise.allSettled(
    enabledSources.map(async (source) => {
      const response = await fetch(
        `${baseUrl}/${encodeURIComponent(source)}?limit=${encodeURIComponent(String(input.perSourceLimit))}`,
        { cache: 'no-store' }
      );
      if (!response.ok) {
        throw new Error(`${source} 拉取失败（HTTP ${response.status}）`);
      }
      const data = (await response.json()) as DailyHotListResponse;
      const list = Array.isArray(data.data) ? data.data : [];
      const sourceName = (data.title || data.name || source).toString();
      return {
        source,
        sourceName,
        list: list.map((item, index): DailyHotTopicItem => {
          const title = String(item.title ?? '').trim();
          return {
            id: String(item.id ?? `${source}-${index + 1}`),
            title,
            source,
            sourceName,
            url: typeof item.url === 'string' ? item.url : undefined,
            timestamp: typeof item.timestamp === 'number' ? item.timestamp : undefined,
            hotValue: parseHot(item.hot),
            rank: index + 1,
          };
        }),
      };
    })
  );

  const topics: DailyHotTopicItem[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const source = enabledSources[index];
    const result = results[index];
    if (result.status === 'fulfilled') {
      const validTopics = result.value.list.filter((topic) => topic.title);
      if (validTopics.length > 0) {
        topics.push(...validTopics);
        stats.push({
          source,
          sourceName: result.value.sourceName,
          status: 'ok',
          itemCount: validTopics.length,
        });
      } else {
        stats.push({
          source,
          sourceName: result.value.sourceName,
          status: 'failed',
          itemCount: 0,
          error: '返回为空',
        });
      }
      continue;
    }
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    const match = message.match(/HTTP\s+(\d{3})/i);
    stats.push({
      source,
      status: 'failed',
      itemCount: 0,
      httpStatus: match ? Number(match[1]) : undefined,
      error: message,
    });
  }

  const healthySources = stats
    .filter((item) => item.status === 'ok' && item.itemCount > 0)
    .map((item) => item.source);
  if (topics.length === 0) {
    throw new Error(
      `热点源返回为空，无法生成选题（状态：${stats
        .map((item) => `${item.source}:${item.status}`)
        .join(', ')}）`
    );
  }
  return {
    topics,
    enabledSources: healthySources,
    stats,
    availableSources,
    disabledSources: Array.from(DISABLED_SOURCES),
  };
}
