/**
 * proxy-fetch.ts
 *
 * 所有对外部 AI API（Gemini / Grok / OpenAI 等）的 HTTP 请求都走这里，
 * 自动读取 BROWSER_PROXY_SERVER 环境变量并挂载代理。
 *
 * 代理格式：host:port:user:pass  或  http://user:pass@host:port
 */

import nodeFetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';

let _agent: HttpsProxyAgent | null | undefined = undefined; // undefined = 未初始化

function getAgent(): HttpsProxyAgent | null {
  if (_agent !== undefined) return _agent;

  const raw = process.env.BROWSER_PROXY_SERVER?.trim();
  if (!raw) {
    _agent = null;
    return null;
  }

  // 支持两种格式
  let proxyUrl: string;
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('socks')) {
    proxyUrl = raw;
  } else {
    // host:port:user:pass
    const parts = raw.split(':');
    const host = parts[0] ?? '';
    const port = parts[1] ?? '8080';
    const user = parts[2];
    const pass = parts[3];
    proxyUrl = user && pass
      ? `http://${user}:${pass}@${host}:${port}`
      : `http://${host}:${port}`;
  }

  try {
    _agent = new HttpsProxyAgent(proxyUrl) as HttpsProxyAgent;
    console.log(`[proxy-fetch] 代理已启用: ${proxyUrl.replace(/:([^@:]+)@/, ':***@')}`);
  } catch (e) {
    console.warn('[proxy-fetch] 代理初始化失败:', e);
    _agent = null;
  }
  return _agent;
}

function shouldBypassProxy(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = (url.hostname || '').trim().toLowerCase();
    if (!host) return true;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (host.endsWith('.local')) return true;
    if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
    return false;
  } catch {
    return true;
  }
}

export interface ProxyFetchResponse {
  ok: boolean;
  status: number;
  headers: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * 发送 HTTP 请求，自动附加代理 agent（如已配置）。
 * 返回的 Response 接口与 native fetch 兼容（ok / status / text / json）。
 */
export async function proxyFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    bypassProxy?: boolean;
  } = {}
): Promise<ProxyFetchResponse> {
  const agent = options.bypassProxy || shouldBypassProxy(url) ? null : getAgent();
  const controller = options.timeoutMs ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs ?? 0))
    : null;

  try {
    if (agent) {
      const res = await nodeFetch(url, {
        method: options.method ?? 'GET',
        headers: options.headers,
        body: options.body,
        signal: controller?.signal,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        agent: agent as any,
      });
      return {
        ok: res.ok,
        status: res.status,
        headers: {
          get: (name: string) => res.headers.get(name),
        },
        text: () => res.text(),
        json: () => res.json() as Promise<unknown>,
        arrayBuffer: () => res.arrayBuffer(),
      };
    }

    // 无代理时直接用 native fetch
    const res = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller?.signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      headers: {
        get: (name: string) => res.headers.get(name),
      },
      text: () => res.text(),
      json: () => res.json() as Promise<unknown>,
      arrayBuffer: () => res.arrayBuffer(),
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
