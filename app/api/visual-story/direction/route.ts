import { NextRequest, NextResponse } from 'next/server';
import { callAI, DEFAULT_DIRECTION_MODEL } from '@/lib/ai-call';
import type { AIProvider } from '@/lib/ai-call';

export const runtime = 'nodejs';

export type StoryDirection = {
  concept: string;
  hook: string;
  mood: string;
  suggestedStyle: string;
  protagonistHint: string;
  worldHint: string;
};

function stripFence(text: string) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
}

function normalizeDirection(raw: unknown): StoryDirection {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    concept:        String(r.concept        || '一个关于成长与告别的奇幻旅程').trim(),
    hook:           String(r.hook           || '每个人心里都有一段说不清楚的离别').trim(),
    mood:           String(r.mood           || '治愈、忧郁、充满希望').trim(),
    suggestedStyle: String(r.suggestedStyle || '宫崎骏水彩插画风格').trim(),
    protagonistHint:String(r.protagonistHint|| '一个独行少女').trim(),
    worldHint:      String(r.worldHint      || '漂浮在云端的古老城市').trim(),
  };
}

const SYSTEM = [
  '你是一位极富创造力的视觉故事总监，擅长为短视频图文内容策划具有强烈画面感的故事方向。',
  '你的方向必须高度发散、每次都不一样，避免平庸的主题。',
  '你要想出那种让人一眼就想看下去的故事概念——有视觉张力、有情感钩子、适合 25～28 张连续插画展示。',
  '所有字段必须是简体中文。',
  '只输出严格 JSON，不要任何 markdown、注释或解释。',
].join('\n');

function buildUser(brief: string) {
  return [
    brief ? `用户方向提示：${brief}` : '用户没有提供方向，请完全自由发挥，给出一个你认为最有意思的故事方向。',
    '请生成一个充满画面感的故事方向。',
    '要求：具体而独特，不要泛泛而谈；有明确的主角形象暗示；有独特的世界观；能拆成 6～7 个关键桥段。',
    '输出格式：{"concept":"","hook":"","mood":"","suggestedStyle":"","protagonistHint":"","worldHint":""}',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      brief?: string;
      provider?: AIProvider;
      model?: string;
    };
    const brief    = String(body.brief || '').trim();
    const provider = body.provider || DEFAULT_DIRECTION_MODEL.provider;
    const model    = body.model    || DEFAULT_DIRECTION_MODEL.model;

    const output = await callAI({
      provider,
      model,
      system:      SYSTEM,
      user:        buildUser(brief),
      temperature: 1.2,
    });

    const direction = normalizeDirection(JSON.parse(stripFence(output)));
    return NextResponse.json({ direction, provider, model });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
