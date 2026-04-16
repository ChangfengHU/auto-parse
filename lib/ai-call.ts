/**
 * ai-call.ts
 * 统一封装 Gemini / Grok / OpenAI 文本生成调用，所有请求走 proxy-fetch。
 */

import { proxyFetch } from './proxy-fetch';

export type AIProvider = 'gemini' | 'grok' | 'openai';

export type AICallOptions = {
  provider: AIProvider;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  /** 仅 Gemini 2.5 系列支持，开启深度思考 */
  thinkingBudget?: number;
};

// ─── Gemini ───────────────────────────────────────────────────────────────────

async function callGemini(opts: AICallOptions): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('缺少 GEMINI_API_KEY');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const genConfig: Record<string, unknown> = { temperature: opts.temperature ?? 0.9 };
  if (opts.thinkingBudget && opts.model.includes('2.5')) {
    genConfig.thinkingConfig = { thinkingBudget: opts.thinkingBudget };
  }

  const res = await proxyFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: 'user', parts: [{ text: opts.user }] }],
      generationConfig: genConfig,
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 300)}`);

  const payload = JSON.parse(text) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  // 过滤 thinking parts，只取正文
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const output = parts
    .filter((p) => !p.thought)
    .map((p) => p.text || '')
    .join('')
    .trim();
  if (!output) throw new Error('Gemini 未返回内容');
  return output;
}

// ─── Grok (xAI) ───────────────────────────────────────────────────────────────

async function callGrok(opts: AICallOptions): Promise<string> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) throw new Error('缺少 XAI_API_KEY');

  const res = await proxyFetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      temperature: opts.temperature ?? 0.9,
      response_format: { type: 'json_object' },
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Grok HTTP ${res.status}: ${text.slice(0, 300)}`);

  const payload = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const output = payload.choices?.[0]?.message?.content?.trim() || '';
  if (!output) throw new Error('Grok 未返回内容');
  return output;
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

async function callOpenAI(opts: AICallOptions): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('缺少 OPENAI_API_KEY');

  const res = await proxyFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      temperature: opts.temperature ?? 0.9,
      response_format: { type: 'json_object' },
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${text.slice(0, 300)}`);

  const payload = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const output = payload.choices?.[0]?.message?.content?.trim() || '';
  if (!output) throw new Error('OpenAI 未返回内容');
  return output;
}

// ─── 统一入口 ─────────────────────────────────────────────────────────────────

export async function callAI(opts: AICallOptions): Promise<string> {
  switch (opts.provider) {
    case 'gemini': return callGemini(opts);
    case 'grok':   return callGrok(opts);
    case 'openai': return callOpenAI(opts);
    default: throw new Error(`未知 provider: ${String(opts.provider)}`);
  }
}

// ─── 预设模型列表（供前端枚举） ──────────────────────────────────────────────

export type ModelOption = {
  provider: AIProvider;
  model: string;
  label: string;
  note: string;
  /** 是否支持深度思考（thinkingBudget） */
  supportsThinking: boolean;
};

export const MODEL_OPTIONS: ModelOption[] = [
  { provider: 'grok',   model: 'grok-3',                  label: 'Grok 3',              note: '旗舰，叙事能力强',       supportsThinking: false },
  { provider: 'grok',   model: 'grok-3-mini',             label: 'Grok 3 Mini',         note: '速度快，创意强',         supportsThinking: false },
  { provider: 'openai', model: 'gpt-4o',                  label: 'GPT-4o',              note: '综合能力强',             supportsThinking: false },
  { provider: 'openai', model: 'gpt-4o-mini',             label: 'GPT-4o Mini',         note: '速度快，价格低',         supportsThinking: false },
  { provider: 'gemini', model: 'gemini-2.5-pro',          label: 'Gemini 2.5 Pro',      note: '深度思考，大纲首选',     supportsThinking: true  },
  { provider: 'gemini', model: 'gemini-2.5-flash',        label: 'Gemini 2.5 Flash',    note: '速度快，适合方向/分镜',  supportsThinking: true  },
];

export const DEFAULT_DIRECTION_MODEL: ModelOption  = MODEL_OPTIONS[1]; // grok-3-mini
export const DEFAULT_OUTLINE_MODEL: ModelOption    = MODEL_OPTIONS[0]; // grok-3
export const DEFAULT_STORYBOARD_MODEL: ModelOption = MODEL_OPTIONS[1]; // grok-3-mini
