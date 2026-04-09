import { NextRequest, NextResponse } from 'next/server';

function stripMarkdownFence(text: string) {
  const raw = text.trim();
  if (!raw.startsWith('```')) return raw;
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
}

function parsePrompts(raw: string): string[] {
  const cleaned = stripMarkdownFence(raw);
  try {
    const parsed = JSON.parse(cleaned) as { prompts?: string[] } | string[];
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || '').trim()).filter(Boolean);
    }
    if (parsed && Array.isArray(parsed.prompts)) {
      return parsed.prompts.map((item) => String(item || '').trim()).filter(Boolean);
    }
  } catch {
    // fallback
  }
  return cleaned
    .split('\n')
    .map((line) => line.replace(/^\s*[-\d.、)\]]+\s*/, '').trim())
    .filter(Boolean);
}

function fallbackPrompts(theme: string, style: string, count: number, extra: string): string[] {
  const suffixes = [
    'high detail, cinematic lighting, 8k',
    'professional composition, rich texture, high quality',
    'dramatic contrast, realistic atmosphere, ultra detailed',
    'soft light, depth of field, premium visual style',
    'clean composition, vivid color, editorial quality',
  ];
  return Array.from({ length: count }, (_, idx) => {
    const sfx = suffixes[idx % suffixes.length];
    return `${theme}，${style}，${extra || '商业级视觉表达'}，${sfx}`;
  });
}

async function callGeminiPrompts(theme: string, style: string, count: number, extra: string): Promise<string[]> {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return fallbackPrompts(theme, style, count, extra);
  }
  const model = String(process.env.IMAGE_PROMPT_MODEL || 'gemini-2.5-flash').trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const system = '你是高级视觉提示词工程师。只输出 JSON。';
  const user = [
    `请生成 ${count} 条用于 Gemini 图片生成的中文提示词。`,
    `主题：${theme}`,
    `风格：${style}`,
    `补充要求：${extra || '无'}`,
    '要求：每条提示词都要具体、可视化、可直接用于文生图，彼此差异明显。',
    '输出格式严格为 JSON：{"prompts":["..."]}',
  ].join('\n');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.7 },
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini 请求失败（HTTP ${response.status}）：${text.slice(0, 240)}`);
  }
  const payload = JSON.parse(text) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const output = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
  if (!output) {
    throw new Error('Gemini 未返回可解析内容');
  }
  const prompts = parsePrompts(output).slice(0, count);
  if (prompts.length === 0) {
    throw new Error('模型未返回有效提示词');
  }
  return prompts;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const theme = String(body.theme || '').trim();
    const style = String(body.style || '').trim();
    const extra = String(body.extra || '').trim();
    const countRaw = Number(body.count ?? 4);
    const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(10, Math.floor(countRaw))) : 4;
    if (!theme) return NextResponse.json({ error: 'theme 不能为空' }, { status: 400 });
    if (!style) return NextResponse.json({ error: 'style 不能为空' }, { status: 400 });

    let prompts: string[];
    try {
      prompts = await callGeminiPrompts(theme, style, count, extra);
    } catch {
      prompts = fallbackPrompts(theme, style, count, extra);
    }
    return NextResponse.json({ theme, style, count: prompts.length, prompts });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
