import { readFileSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';

export type XhsBackendSource = 'cli' | 'http';
export type UploadProvider = 'oss' | 'supabase';

export type FastFailStrategy = 'llm_rewrite' | 'direct_retry' | 'skip';

export interface RuntimeBackendConfig {
  xhs: {
    source: XhsBackendSource;
    httpBaseUrl: string;
    timeoutMs: number;
  };
  adsDispatcher: {
    maxQueueSize: number;
    fastFailStrategy: FastFailStrategy;
  };
  browser: {
    headless: boolean;
  };
  upload: {
    provider: UploadProvider;
    supabaseBucket: string;
  };
}

type PartialRuntimeBackendConfig = Partial<{
  xhs: Partial<RuntimeBackendConfig['xhs']>;
  adsDispatcher: Partial<RuntimeBackendConfig['adsDispatcher']>;
  browser: Partial<RuntimeBackendConfig['browser']>;
  upload: Partial<RuntimeBackendConfig['upload']>;
}>;

const RUNTIME_DIR = join(process.cwd(), '.runtime');
const CONFIG_PATH = join(RUNTIME_DIR, 'backend-config.json');
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_QUEUE_SIZE = 20;

function normalizeSource(value: unknown): XhsBackendSource {
  return value === 'http' ? 'http' : 'cli';
}

function normalizeUploadProvider(value: unknown): UploadProvider {
  return value === 'supabase' ? 'supabase' : 'oss';
}

function normalizeBaseUrl(value: unknown): string {
  const fallback = process.env.XHS_HTTP_BASE_URL || 'http://127.0.0.1:1030';
  const baseUrl = String(value || fallback).trim();
  return baseUrl.replace(/\/+$/, '');
}

function normalizeTimeout(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? DEFAULT_TIMEOUT_MS), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function normalizeMaxQueueSize(value: unknown): number {
  const raw = value ?? process.env.GEMINI_ADS_DISPATCHER_MAX_QUEUE_SIZE ?? DEFAULT_MAX_QUEUE_SIZE;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_QUEUE_SIZE;
  return Math.max(1, Math.min(200, parsed));
}

function normalizeFastFailStrategy(value: unknown): FastFailStrategy {
  if (value === 'llm_rewrite' || value === 'direct_retry' || value === 'skip') return value;
  const env = process.env.GEMINI_ADS_DISPATCHER_FAST_FAIL_STRATEGY;
  if (env === 'llm_rewrite' || env === 'direct_retry' || env === 'skip') return env;
  return 'llm_rewrite';
}

function normalizeHeadless(value: unknown): boolean {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return process.env.BROWSER_HEADLESS !== 'false';
}

function buildDefaultConfig(): RuntimeBackendConfig {
  return {
    xhs: {
      source: normalizeSource(process.env.XHS_BACKEND_SOURCE),
      httpBaseUrl: normalizeBaseUrl(process.env.XHS_HTTP_BASE_URL),
      timeoutMs: normalizeTimeout(process.env.XHS_HTTP_TIMEOUT_MS),
    },
    adsDispatcher: {
      maxQueueSize: normalizeMaxQueueSize(undefined),
      fastFailStrategy: normalizeFastFailStrategy(undefined),
    },
    browser: {
      headless: normalizeHeadless(undefined),
    },
    upload: {
      provider: normalizeUploadProvider(process.env.UPLOAD_PROVIDER),
      supabaseBucket: String(process.env.SUPABASE_STORAGE_BUCKET || 'filestore').trim() || 'filestore',
    },
  };
}

function mergeConfig(partial?: PartialRuntimeBackendConfig): RuntimeBackendConfig {
  const defaults = buildDefaultConfig();

  return {
    xhs: {
      source: normalizeSource(partial?.xhs?.source ?? defaults.xhs.source),
      httpBaseUrl: normalizeBaseUrl(partial?.xhs?.httpBaseUrl ?? defaults.xhs.httpBaseUrl),
      timeoutMs: normalizeTimeout(partial?.xhs?.timeoutMs ?? defaults.xhs.timeoutMs),
    },
    adsDispatcher: {
      maxQueueSize: normalizeMaxQueueSize(partial?.adsDispatcher?.maxQueueSize ?? defaults.adsDispatcher.maxQueueSize),
      fastFailStrategy: normalizeFastFailStrategy(partial?.adsDispatcher?.fastFailStrategy ?? defaults.adsDispatcher.fastFailStrategy),
    },
    browser: {
      headless: normalizeHeadless(partial?.browser?.headless ?? defaults.browser.headless),
    },
    upload: {
      provider: normalizeUploadProvider(partial?.upload?.provider ?? defaults.upload.provider),
      supabaseBucket: String(partial?.upload?.supabaseBucket ?? defaults.upload.supabaseBucket ?? 'filestore').trim() || 'filestore',
    },
  };
}

async function readStoredConfig(): Promise<PartialRuntimeBackendConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as PartialRuntimeBackendConfig;
  } catch {
    return null;
  }
}

function readStoredConfigSync(): PartialRuntimeBackendConfig | null {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as PartialRuntimeBackendConfig;
  } catch {
    return null;
  }
}

export async function getRuntimeBackendConfig(): Promise<RuntimeBackendConfig> {
  const stored = await readStoredConfig();
  return mergeConfig(stored ?? undefined);
}

export function getRuntimeBackendConfigSync(): RuntimeBackendConfig {
  const stored = readStoredConfigSync();
  return mergeConfig(stored ?? undefined);
}

export async function saveRuntimeBackendConfig(input: PartialRuntimeBackendConfig): Promise<RuntimeBackendConfig> {
  const current = await readStoredConfig();
  const merged = mergeConfig({
    ...current,
    ...input,
    xhs: {
      ...(current?.xhs ?? {}),
      ...(input.xhs ?? {}),
    },
    adsDispatcher: {
      ...(current?.adsDispatcher ?? {}),
      ...(input.adsDispatcher ?? {}),
    },
    browser: {
      ...(current?.browser ?? {}),
      ...(input.browser ?? {}),
    },
    upload: {
      ...(current?.upload ?? {}),
      ...(input.upload ?? {}),
    },
  });

  await mkdir(RUNTIME_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

export async function resetRuntimeBackendConfig(): Promise<RuntimeBackendConfig> {
  await rm(CONFIG_PATH, { force: true });
  return buildDefaultConfig();
}

export function getRuntimeBackendConfigPath() {
  return CONFIG_PATH;
}
