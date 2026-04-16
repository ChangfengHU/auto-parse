import { NextRequest, NextResponse } from 'next/server';
import type { StoryDirection } from '../direction/route';
import { callAI, DEFAULT_OUTLINE_MODEL } from '@/lib/ai-call';
import type { AIProvider } from '@/lib/ai-call';

export const runtime = 'nodejs';
// 深度思考模型，生成包含视觉锁定元素的完整故事大纲
// Visual Lock 是所有图片共享的锚点字符串，直接注入每条英文 prompt 实现连贯性

export type VisualLock = {
  /** 直接用于英文 prompt 的画风关键词 */
  styleKeywords: string;
  /** 直接用于英文 prompt 的色调描述 */
  colorPalette: string;
  /** 直接用于英文 prompt 的光线描述 */
  lightingStyle: string;
  /** 品质关键词，前缀固定 */
  artQuality: string;
};

export type CharacterLock = {
  name: string;
  role: string;
  /** 极详细的英文外貌描述，直接注入每条 prompt */
  visualDescription: string;
  /** 中文外貌说明，给人看 */
  visualDescriptionZh: string;
};

export type SegmentBeat = {
  /** 0-3，该 beat 在桥段内的位置 */
  beatIndex: number;
  /** 中文，故事节拍说明 */
  narrative: string;
  /** 镜头类型建议（英文关键词，注入 prompt） */
  shotType: string;
  /** 这一拍的核心情绪/动作（英文，注入 prompt） */
  actionKeyword: string;
};

export type StorySegment = {
  segmentIndex: number;
  /** 中文桥段标题 */
  title: string;
  /** 中文桥段整体说明 */
  narrative: string;
  /** 该桥段的场景关键词（英文，所有 4 张图共享） */
  environmentKeyword: string;
  beats: SegmentBeat[];
};

export type StoryOutline = {
  title: string;
  logline: string;
  emotionalArc: string;
  visualLock: VisualLock;
  characters: CharacterLock[];
  segments: StorySegment[];
};

function stripFence(text: string) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
}

function normalizeVisualLock(raw: unknown): VisualLock {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    styleKeywords: String(r.styleKeywords || 'Miyazaki-inspired soft watercolor illustration, hand-painted texture, storybook quality').trim(),
    colorPalette: String(r.colorPalette || 'warm golden tones, soft pastel palette of peach, lavender and sage green, harmonious color grading').trim(),
    lightingStyle: String(r.lightingStyle || 'soft directional warm light, gentle atmospheric depth, subtle volumetric glow').trim(),
    artQuality: String(r.artQuality || 'masterpiece, best quality, highly detailed illustration, crisp clean lines, premium composition').trim(),
  };
}

function normalizeCharacter(raw: unknown): CharacterLock {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    name: String(r.name || '主角').trim(),
    role: String(r.role || '主角').trim(),
    visualDescription: String(r.visualDescription || 'a young protagonist with distinctive appearance and consistent outfit').trim(),
    visualDescriptionZh: String(r.visualDescriptionZh || '主角').trim(),
  };
}

function normalizeBeat(raw: unknown, beatIndex: number): SegmentBeat {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const defaultShots = ['wide establishing shot', 'medium shot', 'close-up emotional shot', 'cinematic wide shot'];
  return {
    beatIndex,
    narrative: String(r.narrative || `节拍 ${beatIndex + 1}`).trim(),
    shotType: String(r.shotType || defaultShots[beatIndex] || 'medium shot').trim(),
    actionKeyword: String(r.actionKeyword || 'standing, looking ahead').trim(),
  };
}

function normalizeSegment(raw: unknown, segmentIndex: number): StorySegment {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawBeats = Array.isArray(r.beats) ? r.beats : [];
  // 确保恰好 4 个 beat
  const beats: SegmentBeat[] = Array.from({ length: 4 }, (_, i) =>
    normalizeBeat(rawBeats[i] ?? {}, i)
  );
  return {
    segmentIndex,
    title: String(r.title || `桥段 ${segmentIndex + 1}`).trim(),
    narrative: String(r.narrative || '').trim(),
    environmentKeyword: String(r.environmentKeyword || 'scenic environment with atmospheric depth').trim(),
    beats,
  };
}

function normalizeOutline(raw: unknown): StoryOutline {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawSegments = Array.isArray(r.segments) ? r.segments : [];
  const segments = rawSegments.slice(0, 7).map((s, i) => normalizeSegment(s, i));
  return {
    title: String(r.title || '无题故事').trim(),
    logline: String(r.logline || '').trim(),
    emotionalArc: String(r.emotionalArc || '').trim(),
    visualLock: normalizeVisualLock(r.visualLock),
    characters: Array.isArray(r.characters) ? r.characters.map(normalizeCharacter) : [],
    segments,
  };
}

async function generateOutline(
  direction: StoryDirection,
  segmentCount: number,
  provider: AIProvider,
  model: string,
): Promise<StoryOutline> {

  const system = [
    '你是一位同时精通故事创作与视觉提示词工程的高级视觉叙事总监。',
    '你的任务是为一个连续插画故事项目生成完整的视觉大纲，包含故事结构 AND 视觉锁定元素。',
    '',
    '【视觉锁定的重要性】',
    '这个项目会生成 25-28 张图片，每张图片由 AI 独立生成，没有记忆。',
    '要让所有图片看起来是同一个故事，必须在每张图的 prompt 里注入完全相同的"视觉锁定"字符串：',
    '  - styleKeywords：统一画风关键词（英文）',
    '  - colorPalette：统一色调（英文）',
    '  - lightingStyle：统一光线（英文）',
    '  - 角色 visualDescription：极精细的外貌描述（英文），必须包含：发色发型、服装颜色和细节、配饰、眼睛颜色、年龄身形',
    '',
    '【故事结构】',
    `请将故事分成 ${segmentCount} 个桥段，每个桥段包含 4 个画面节拍（beat）。`,
    '每个 beat 是一张图片，4 张合起来讲一个完整的桥段故事。',
    'beat 0：开场/建立场景  beat 1：发展/角色动作  beat 2：情绪高峰  beat 3：收束/过渡到下一桥段',
    '',
    '输出全部字段。中文字段用中文，英文字段（styleKeywords/colorPalette/lightingStyle/artQuality/visualDescription/environmentKeyword/shotType/actionKeyword）必须用英文。',
    '只输出严格 JSON，不要 markdown 围栏，不要任何解释。',
  ].join('\n');

  const jsonSchema = `{
  "title": "故事标题",
  "logline": "一句话故事梗概（中文）",
  "emotionalArc": "情绪弧线说明（中文）",
  "visualLock": {
    "styleKeywords": "英文画风关键词",
    "colorPalette": "英文色调",
    "lightingStyle": "英文光线",
    "artQuality": "英文品质关键词"
  },
  "characters": [
    {
      "name": "角色名（中文）",
      "role": "角色定位（中文）",
      "visualDescription": "极详细英文外貌，包含：age, hair color and style, eye color, outfit with specific colors and details, accessories, body type. This exact string will be pasted into every image prompt.",
      "visualDescriptionZh": "中文外貌说明"
    }
  ],
  "segments": [
    {
      "segmentIndex": 0,
      "title": "桥段标题（中文）",
      "narrative": "桥段故事说明（中文）",
      "environmentKeyword": "英文场景关键词，所有4张图共享",
      "beats": [
        {"beatIndex": 0, "narrative": "中文节拍说明", "shotType": "英文镜头类型", "actionKeyword": "英文核心动作或情绪"},
        {"beatIndex": 1, "narrative": "", "shotType": "", "actionKeyword": ""},
        {"beatIndex": 2, "narrative": "", "shotType": "", "actionKeyword": ""},
        {"beatIndex": 3, "narrative": "", "shotType": "", "actionKeyword": ""}
      ]
    }
  ]
}`;

  const user = [
    `故事方向：`,
    `  概念：${direction.concept}`,
    `  情感钩子：${direction.hook}`,
    `  情绪基调：${direction.mood}`,
    `  推荐风格：${direction.suggestedStyle}`,
    `  主角暗示：${direction.protagonistHint}`,
    `  世界观暗示：${direction.worldHint}`,
    '',
    `请基于此方向，深度创作一个完整的视觉故事大纲，分 ${segmentCount} 个桥段，每桥段 4 张图。`,
    '要求：',
    '  1. 故事要真正好看，有情绪起伏、有意外转折、有令人印象深刻的画面高峰',
    '  2. 视觉锁定元素要极其精确，角色的每个细节都要写清楚，确保 AI 每次生成时外观一致',
    '  3. 桥段之间要有叙事连贯性，beat 3 应该为下一桥段的 beat 0 做铺垫',
    '  4. 场景要多样化，不要每个桥段都在同一个地方',
    '',
    `输出格式（严格 JSON）：${jsonSchema}`,
  ].join('\n');

  // Gemini 2.5 系列开启深度思考
  const thinkingBudget = provider === 'gemini' && model.includes('2.5') ? 8000 : undefined;

  const output = await callAI({
    provider,
    model,
    system,
    user,
    temperature: 1.0,
    thinkingBudget,
  });

  const parsed = JSON.parse(stripFence(output)) as unknown;
  return normalizeOutline(parsed);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      direction?: StoryDirection;
      segmentCount?: number;
      provider?: AIProvider;
      model?: string;
    };
    const direction = body.direction;
    if (!direction?.concept) return NextResponse.json({ error: '缺少 direction' }, { status: 400 });

    const segmentCount = Math.max(5, Math.min(7, Number(body.segmentCount) || 6));
    const provider = body.provider || DEFAULT_OUTLINE_MODEL.provider;
    const model    = body.model    || DEFAULT_OUTLINE_MODEL.model;

    const outline = await generateOutline(direction, segmentCount, provider, model);
    return NextResponse.json({ outline, provider, model });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
