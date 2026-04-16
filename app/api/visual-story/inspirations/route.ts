import { NextRequest, NextResponse } from 'next/server';
import { proxyFetch } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';

type IdeaPreset = {
  id: string;
  title: string;
  hook: string;
  theme: string;
  style: string;
  tone: string;
  sceneCount: number;
  audience: string;
  extraPrompt: string;
  tags: string[];
};

type ProviderName = 'gemini' | 'grok' | 'openai' | 'fallback';

function stripMarkdownFence(text: string) {
  const raw = text.trim();
  if (!raw.startsWith('```')) return raw;
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
}

function toStringList(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeIdea(input: unknown, index: number): IdeaPreset {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const title = String(raw.title || `灵感方向 ${index + 1}`).trim();
  const theme = String(raw.theme || title).trim();
  const style = String(raw.style || '高端绘本叙事插画').trim();
  const tone = String(raw.tone || '治愈，梦幻，适合连续图文').trim();
  const sceneCountRaw = Number(raw.sceneCount ?? 6);
  const sceneCount = Number.isFinite(sceneCountRaw) ? Math.max(4, Math.min(10, Math.floor(sceneCountRaw))) : 6;
  return {
    id: String(raw.id || `idea-${index + 1}`).trim(),
    title,
    hook: String(raw.hook || `${theme}，适合做成 ${sceneCount} 张连续视觉故事`).trim(),
    theme,
    style,
    tone,
    sceneCount,
    audience: String(raw.audience || '抖音图文 / 小红书绘本感内容').trim(),
    extraPrompt: String(
      raw.extraPrompt ||
        `${tone}。主角形象统一，画面强调封面感、叙事感、角色辨识度和社媒传播性。`
    ).trim(),
    tags: toStringList(raw.tags).slice(0, 5),
  };
}

function buildFallbackIdeas(brief: string) {
  const keyword = brief.trim() || '治愈系童话';
  const tonePool = ['治愈梦幻', '轻奇幻', '少女感', '电影感旅行', '东方神话', '情绪疗愈', '角色反差'];
  const rolePool = ['小狐狸', '魔法邮差', '机械女孩', '借月少女', '猫咪店长', '海边旅人', '森林学徒'];
  const scenePool = ['月光森林', '春日花园', '云上列车', '蒸汽城堡', '海边小镇', '古风云海', '雨夜街巷'];
  const stylePool = [
    '宫崎骏式温柔童话插画',
    '梦幻水彩儿童绘本',
    '电影感奇幻概念艺术',
    '复古油画质感插画',
    '高端绘本叙事插画',
    '国潮神话插图',
  ];

  return Array.from({ length: 6 }, (_, index) => {
    const role = rolePool[(index + keyword.length) % rolePool.length];
    const scene = scenePool[(index * 2 + keyword.length) % scenePool.length];
    const tone = tonePool[(index + keyword.length * 3) % tonePool.length];
    const style = stylePool[(index + keyword.length * 5) % stylePool.length];
    const sceneCount = 5 + ((index + keyword.length) % 2);
    return {
      id: `idea-${index + 1}`,
      title: `${scene}里的${role}`,
      hook: `${tone}方向，适合连续 ${sceneCount} 张绘本图，角色辨识度和封面感都比较稳定。`,
      theme: `${keyword} / ${scene}`,
      style,
      tone: `${tone}，适合社媒连续图文叙事`,
      sceneCount,
      audience: '适合抖音图文、小红书连续插画和短篇绘本感内容',
      extraPrompt: `主角为${role}，主场景为${scene}，请强化角色统一、镜头叙事、光影层次和社媒封面感。`,
      tags: [keyword || '灵感', role, scene, tone, '连续绘本'],
    } satisfies IdeaPreset;
  });
}

function buildPrompt(brief: string, count: number) {
  const system = [
    '你是一名非常擅长短视频图文选题策划、绘本叙事包装和视觉概念开发的创意总监。',
    '请为用户生成可直接用于视觉故事创作的灵感卡。',
    '所有字段内容必须使用简体中文，不允许输出英文标题、英文描述、英文标签或中英混杂表达。',
    '风格字段也必须写成中文，例如“梦幻水彩儿童绘本”“高端绘本叙事插画”，不能写英文风格名。',
    '输出必须是严格 JSON，不要 markdown，不要解释，不要额外文本。',
  ].join('\n');
  const user = [
    `用户需求：${brief || '我不知道做什么，先给我一些低门槛但高完成度的视觉故事方向'}`,
    `请生成 ${count} 个灵感卡。`,
    '每个灵感卡都必须适合连续 4 到 10 张图的视觉故事，并包含：title、hook、theme、style、tone、sceneCount、audience、extraPrompt、tags。',
    '要求：题材之间差异明显，有治愈、奇幻、角色反差、氛围感、东方审美等不同方向，适合抖音图文或连续插画内容。',
    '再次强调：返回值中的所有自然语言字段必须是简体中文。',
    '输出格式严格为 JSON：{"ideas":[{"id":"idea-1","title":"","hook":"","theme":"","style":"","tone":"","sceneCount":6,"audience":"","extraPrompt":"","tags":[""]}]}',
  ].join('\n');
  return { system, user };
}

function containsTooMuchEnglish(value: string) {
  const letters = value.match(/[A-Za-z]/g)?.length ?? 0;
  const chinese = value.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return letters >= 6 && chinese === 0;
}

function assertIdeasAreChinese(ideas: IdeaPreset[]) {
  const invalid = ideas.find((idea) =>
    containsTooMuchEnglish(idea.title) ||
    containsTooMuchEnglish(idea.hook) ||
    containsTooMuchEnglish(idea.theme) ||
    containsTooMuchEnglish(idea.style) ||
    containsTooMuchEnglish(idea.tone) ||
    containsTooMuchEnglish(idea.audience) ||
    containsTooMuchEnglish(idea.extraPrompt) ||
    idea.tags.some((tag) => containsTooMuchEnglish(tag))
  );
  if (invalid) {
    throw new Error('模型返回了英文灵感卡，已切换下一个供应商');
  }
}

function parseIdeas(rawText: string, count: number) {
  const parsed = JSON.parse(stripMarkdownFence(rawText)) as { ideas?: unknown[] };
  if (!Array.isArray(parsed.ideas) || parsed.ideas.length === 0) {
    throw new Error('模型未返回有效灵感卡');
  }
  const ideas = parsed.ideas.slice(0, count).map((idea, index) => normalizeIdea(idea, index));
  assertIdeasAreChinese(ideas);
  return ideas;
}

async function generateWithGemini(brief: string, count: number) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('缺少 GEMINI_API_KEY');
  }
  const model = String(process.env.IMAGE_PROMPT_MODEL || 'gemini-2.5-flash').trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const { system, user } = buildPrompt(brief, count);

  const response = await proxyFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.9 },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini 请求失败（HTTP ${response.status}）：${text.slice(0, 240)}`);
  }

  const payload = JSON.parse(text) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const output = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
  if (!output) {
    throw new Error('Gemini 未返回可解析内容');
  }
  return parseIdeas(output, count);
}

async function generateWithGrok(brief: string, count: number) {
  const apiKey = String(process.env.XAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('缺少 XAI_API_KEY');
  }
  const { system, user } = buildPrompt(brief, count);
  const response = await proxyFetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-3-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.9,
      response_format: { type: 'json_object' },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Grok 请求失败（HTTP ${response.status}）：${text.slice(0, 240)}`);
  }

  const payload = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const output = payload.choices?.[0]?.message?.content?.trim() || '';
  if (!output) {
    throw new Error('Grok 未返回可解析内容');
  }
  return parseIdeas(output, count);
}

async function generateWithOpenAI(brief: string, count: number) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('缺少 OPENAI_API_KEY');
  }
  const { system, user } = buildPrompt(brief, count);
  const response = await proxyFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.9,
      response_format: { type: 'json_object' },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI 请求失败（HTTP ${response.status}）：${text.slice(0, 240)}`);
  }

  const payload = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const output = payload.choices?.[0]?.message?.content?.trim() || '';
  if (!output) {
    throw new Error('OpenAI 未返回可解析内容');
  }
  return parseIdeas(output, count);
}

async function generateIdeas(brief: string, count: number) {
  const errors: string[] = [];
  const providers: Array<{ name: ProviderName; run: () => Promise<IdeaPreset[]> }> = [
    { name: 'grok', run: () => generateWithGrok(brief, count) },
    { name: 'openai', run: () => generateWithOpenAI(brief, count) },
    { name: 'gemini', run: () => generateWithGemini(brief, count) },
  ];

  for (const provider of providers) {
    try {
      const ideas = await provider.run();
      return { provider: provider.name, ideas, errors };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider.name}: ${message}`);
    }
  }

  return {
    provider: 'fallback' as const,
    ideas: buildFallbackIdeas(brief).slice(0, count),
    errors,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const brief = String(body.brief || '').trim();
    const countRaw = Number(body.count ?? 6);
    const count = Number.isFinite(countRaw) ? Math.max(3, Math.min(8, Math.floor(countRaw))) : 6;

    const result = await generateIdeas(brief, count);
    return NextResponse.json({
      brief,
      provider: result.provider,
      ideas: result.ideas,
      warnings: result.errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
