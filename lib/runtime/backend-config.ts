import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';

export type XhsBackendSource = 'cli' | 'http';

export interface RuntimeBackendConfig {
  xhs: {
    source: XhsBackendSource;
    httpBaseUrl: string;
    timeoutMs: number;
  };
}

type PartialRuntimeBackendConfig = Partial<{
  xhs: Partial<RuntimeBackendConfig['xhs']>;
}>;

const RUNTIME_DIR = join(process.cwd(), '.runtime');
const CONFIG_PATH = join(RUNTIME_DIR, 'backend-config.json');
const DEFAULT_TIMEOUT_MS = 45_000;

function normalizeSource(value: unknown): XhsBackendSource {
  return value === 'http' ? 'http' : 'cli';
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

function buildDefaultConfig(): RuntimeBackendConfig {
  return {
    xhs: {
      source: normalizeSource(process.env.XHS_BACKEND_SOURCE),
      httpBaseUrl: normalizeBaseUrl(process.env.XHS_HTTP_BASE_URL),
      timeoutMs: normalizeTimeout(process.env.XHS_HTTP_TIMEOUT_MS),
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

export async function getRuntimeBackendConfig(): Promise<RuntimeBackendConfig> {
  const stored = await readStoredConfig();
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
