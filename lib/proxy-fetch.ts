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

export interface ProxyFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
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
  } = {}
): Promise<ProxyFetchResponse> {
  const agent = getAgent();

  if (agent) {
    const res = await nodeFetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agent: agent as any,
    });
    return {
      ok: res.ok,
      status: res.status,
      text: () => res.text(),
      json: () => res.json() as Promise<unknown>,
    };
  }

  // 无代理时直接用 native fetch
  const res = await fetch(url, options);
  return {
    ok: res.ok,
    status: res.status,
    text: () => res.text(),
    json: () => res.json() as Promise<unknown>,
  };
}
