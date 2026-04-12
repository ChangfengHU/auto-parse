import { chromium } from 'playwright';
import { listLiveSessions } from '@/lib/workflow/session-store';

type InstanceState = 'idle' | 'busy' | 'inactive';

interface LeaseInfo {
  leaseId: string;
  jobId: string;
  acquiredAt: number;
}

export interface InstanceStatus {
  instanceId: string;
  state: InstanceState;
  tabOpen: boolean;
  active: boolean;
  locked: boolean;
  leaseId?: string;
  lockJobId?: string;
  source: 'session' | 'adspower' | 'none';
  sessionId?: string;
  sessionStatus?: string;
  detail?: string;
}

declare global {
  var __adsPoolLeases: Map<string, LeaseInfo> | undefined;
}

function leaseStore() {
  if (!global.__adsPoolLeases) {
    global.__adsPoolLeases = new Map();
  }
  return global.__adsPoolLeases;
}

const DEFAULT_LEASE_TTL_MS = Number(process.env.ADS_INSTANCE_LEASE_TTL_MS || 15 * 60 * 1000);

function pruneExpiredLeases() {
  const now = Date.now();
  const store = leaseStore();
  for (const [instanceId, lease] of store.entries()) {
    if (now - lease.acquiredAt > DEFAULT_LEASE_TTL_MS) {
      store.delete(instanceId);
    }
  }
}

function resolveApiBase() {
  return (process.env.ADS_API_URL || 'http://127.0.0.1:50325').trim();
}

function resolveApiKey() {
  return (process.env.ADS_API_KEY || '').trim();
}

function buildHeaders(apiKey: string): Record<string, string> {
  if (!apiKey) return {};
  return {
    Authorization: `Bearer ${apiKey}`,
    'api-key': apiKey,
  };
}

export function resolvePoolInstanceIds(explicit?: string[]): string[] {
  if (Array.isArray(explicit) && explicit.length > 0) {
    return explicit.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const fromEnv = String(process.env.ADS_INSTANCE_POOL_IDS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  return ['k1b908rw', 'k1bdaoa7', 'k1ba8vac'];
}

function findSessionOccupancy(instanceId: string): InstanceStatus | null {
  const sessions = listLiveSessions();
  for (const session of sessions) {
    const sid = String(session.vars?.browserInstanceId || '').trim();
    if (!sid || sid !== instanceId) continue;
    const page = session._page;
    const tabOpen = Boolean(page && !page.isClosed());
    if (!tabOpen) continue;
    const sessionUrl = (() => {
      try {
        return page?.url?.() || '';
      } catch {
        return '';
      }
    })();
    const reusablePoolTab = isWorkingTabUrl(sessionUrl);
    const blockingByState = session.status === 'running' || session.status === 'paused';
    if (!blockingByState) continue;
    return {
      instanceId,
      state: 'busy',
      tabOpen: reusablePoolTab,
      active: true,
      locked: false,
      source: 'session',
      sessionId: session.id,
      sessionStatus: session.status,
      detail: reusablePoolTab ? `会话占用工作页：${sessionUrl}` : `会话状态为 ${session.status}`,
    };
  }
  return null;
}

function isWorkingTabUrl(url: string): boolean {
  const value = String(url || '').trim().toLowerCase();
  if (!value || value === 'about:blank') return false;
  if (value.startsWith('data:')) return false;
  if (value.startsWith('chrome://newtab')) return false;
  if (value.startsWith('chrome://new-tab-page')) return false;
  if (value.startsWith('edge://newtab')) return false;
  if (value.startsWith('edge://new-tab-page')) return false;
  if (value.startsWith('brave://newtab')) return false;
  if (value.startsWith('vivaldi://newtab')) return false;
  if (value.startsWith('devtools://')) return false;
  if (value.startsWith('chrome-extension://')) return false;
  if (value.includes('/_/chrome/newtab')) return false;
  if (value.includes('new-tab-page')) return false;

  const allowedHosts = String(process.env.ADS_POOL_WORKING_HOSTS || 'gemini.google.com')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (allowedHosts.length === 0) return true;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return allowedHosts.some((item) => host === item || host.endsWith(`.${item}`));
  } catch {
    return false;
  }
}

function truncateUrl(url: string) {
  return url.length > 80 ? `${url.slice(0, 77)}...` : url;
}

function summarizeWorkingTabs(urls: string[]) {
  if (urls.length === 0) return '未检测到工作标签页';
  if (urls.length === 1) return `Gemini 工作页已就绪: ${truncateUrl(urls[0])}`;
  return `Gemini 工作页 ${urls.length} 个，默认按可复用处理，首个: ${truncateUrl(urls[0])}`;
}

async function inspectByAdsPower(instanceId: string): Promise<Pick<InstanceStatus, 'active' | 'tabOpen' | 'source' | 'detail'>> {
  const apiBase = resolveApiBase();
  const apiKey = resolveApiKey();
  const url = new URL(`${apiBase}/api/v1/browser/active`);
  url.searchParams.set('user_id', instanceId);
  if (apiKey) {
    url.searchParams.set('apikey', apiKey);
    url.searchParams.set('api_key', apiKey);
  }
  const headers = buildHeaders(apiKey);

  const res = await fetch(url.toString(), { method: 'GET', headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    return { active: false, tabOpen: false, source: 'none', detail: `Ads API HTTP ${res.status}` };
  }

  const data = await res.json() as {
    code?: number;
    msg?: string;
    data?: { status?: string; ws?: { puppeteer?: string } };
  };
  if (data.code !== 0) {
    return { active: false, tabOpen: false, source: 'none', detail: data.msg || 'Ads API 返回非 0' };
  }

  const wsEndpoint = data.data?.ws?.puppeteer?.trim() || '';
  const rawStatus = String(data.data?.status || '').trim().toLowerCase();
  if (!wsEndpoint) {
    if (rawStatus === 'inactive') {
      return { active: false, tabOpen: false, source: 'none', detail: '分身未激活（AdsPower 未返回 ws）' };
    }
    return { active: false, tabOpen: false, source: 'none', detail: '分身未提供可用 ws，当前不可调度' };
  }

  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  try {
    browser = await chromium.connectOverCDP(wsEndpoint);
    const contexts = browser.contexts();
    const workingTabs = contexts.flatMap((ctx) =>
      ctx
        .pages()
        .filter((page) => !page.isClosed())
        .map((page) => {
          try {
            return page.url();
          } catch {
            return '';
          }
        })
        .filter((url) => isWorkingTabUrl(url))
    );
    const hasReusableGeminiTab = workingTabs.length > 0;
    return {
      active: true,
      tabOpen: false,
      source: 'adspower',
      detail: hasReusableGeminiTab
        ? summarizeWorkingTabs(workingTabs)
        : '仅检测到空白/默认标签页，判定为空闲',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { active: true, tabOpen: false, source: 'adspower', detail: `CDP 检测失败: ${message}` };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

export async function getInstanceStatus(instanceId: string): Promise<InstanceStatus> {
  pruneExpiredLeases();
  const lock = leaseStore().get(instanceId);
  const occupiedBySession = findSessionOccupancy(instanceId);
  if (occupiedBySession) {
    return {
      ...occupiedBySession,
      locked: Boolean(lock),
      leaseId: lock?.leaseId,
      lockJobId: lock?.jobId,
      state: 'busy',
    };
  }

  const adsInspect = await inspectByAdsPower(instanceId);
  const tabOpen = adsInspect.tabOpen;
  const state: InstanceState = !adsInspect.active
    ? 'inactive'
    : (tabOpen || Boolean(lock))
      ? 'busy'
      : 'idle';

  return {
    instanceId,
    state,
    tabOpen,
    active: adsInspect.active,
    locked: Boolean(lock),
    leaseId: lock?.leaseId,
    lockJobId: lock?.jobId,
    source: adsInspect.source,
    detail: adsInspect.detail,
  };
}

export async function getDispatchableInstanceStatus(instanceId: string): Promise<InstanceStatus> {
  pruneExpiredLeases();
  const lock = leaseStore().get(instanceId);
  const adsInspect = await inspectByAdsPower(instanceId);
  const state: InstanceState = lock ? 'busy' : 'idle';

  return {
    instanceId,
    state,
    tabOpen: false,
    active: adsInspect.active,
    locked: Boolean(lock),
    leaseId: lock?.leaseId,
    lockJobId: lock?.jobId,
    source: adsInspect.source,
    detail: lock ? `实例已被调度器锁定：${lock.jobId}` : adsInspect.detail,
  };
}

export async function listInstanceStatuses(instanceIds: string[]): Promise<InstanceStatus[]> {
  const unique = Array.from(new Set(instanceIds.map((item) => item.trim()).filter(Boolean)));
  return Promise.all(unique.map((id) => getInstanceStatus(id)));
}

export async function listDispatchableInstanceStatuses(instanceIds: string[]): Promise<InstanceStatus[]> {
  const unique = Array.from(new Set(instanceIds.map((item) => item.trim()).filter(Boolean)));
  return Promise.all(unique.map((id) => getDispatchableInstanceStatus(id)));
}

export async function acquireInstanceLease(
  instanceId: string,
  jobId: string,
  options?: { mode?: 'default' | 'dispatcher' }
): Promise<{ ok: boolean; reason?: string; leaseId?: string; status: InstanceStatus }> {
  const useDispatcherMode = options?.mode === 'dispatcher';
  const current = useDispatcherMode
    ? await getDispatchableInstanceStatus(instanceId)
    : await getInstanceStatus(instanceId);
  if (current.state !== 'idle') {
    return { ok: false, reason: `实例当前为 ${current.state}`, status: current };
  }
  const store = leaseStore();
  if (store.has(instanceId)) {
    const now = useDispatcherMode
      ? await getDispatchableInstanceStatus(instanceId)
      : await getInstanceStatus(instanceId);
    return { ok: false, reason: '实例已被其他任务锁定', status: now };
  }
  const leaseId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  store.set(instanceId, { leaseId, jobId, acquiredAt: Date.now() });
  const status = useDispatcherMode
    ? await getDispatchableInstanceStatus(instanceId)
    : await getInstanceStatus(instanceId);
  return { ok: true, leaseId, status };
}

export async function releaseInstanceLease(
  instanceId: string,
  leaseId?: string,
  options?: { mode?: 'default' | 'dispatcher' }
): Promise<InstanceStatus> {
  const store = leaseStore();
  const current = store.get(instanceId);
  if (current && (!leaseId || current.leaseId === leaseId)) {
    store.delete(instanceId);
  }
  return options?.mode === 'dispatcher'
    ? getDispatchableInstanceStatus(instanceId)
    : getInstanceStatus(instanceId);
}
