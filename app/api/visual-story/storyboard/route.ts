import { NextRequest, NextResponse } from 'next/server';
import type { StoryOutline, StorySegment, CharacterLock, VisualLock } from '../outline/route';
import { callAI, DEFAULT_STORYBOARD_MODEL } from '@/lib/ai-call';
import type { AIProvider } from '@/lib/ai-call';
import { proxyFetch } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';

export type StoryScene = {
  segmentIndex: number;
  beatIndex: number;
  globalIndex: number;
  /** 中文节拍说明 */
  narrative: string;
  /** 最终英文生图 prompt，包含全部视觉锁定元素 */
  prompt: string;
};

export type StoryboardSegment = {
  segmentIndex: number;
  title: string;
  narrative: string;
  scenes: StoryScene[];
};

// ─── 构建 prompt 锁定前缀（所有图片完全相同） ───────────────────────────────

function buildLockHeader(visualLock: VisualLock, characters: CharacterLock[]): string {
  const charParts = characters.map(c =>
    `${c.name}: ${c.visualDescription}`
  );
  return [
    visualLock.artQuality,
    visualLock.styleKeywords,
    visualLock.colorPalette,
    visualLock.lightingStyle,
    ...charParts,
  ]
    .filter(Boolean)
    .join(', ');
}

// ─── 构建单张图片 prompt ─────────────────────────────────────────────────────

function buildScenePrompt(
  lockHeader: string,
  segment: StorySegment,
  beatIndex: number,
  sceneSpecific: string
): string {
  const beat = segment.beats[beatIndex];
  const parts = [
    lockHeader,
    `environment: ${segment.environmentKeyword}`,
    beat ? `${beat.shotType}, ${beat.actionKeyword}` : '',
    sceneSpecific,
    'no text, no watermark, no logo',
  ].filter(Boolean);
  return parts.join(', ');
}

function stripFence(text: string) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
}

// ─── AI 生成每个 beat 的 scene-specific 英文描述 ─────────────────────────────

async function generateSceneSpecifics(outline: StoryOutline): Promise<string[][]> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('缺少 GEMINI_API_KEY');

  const model = process.env.VISUAL_STORY_STORYBOARD_MODEL?.trim() || 'gemini-2.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const system = [
    '你是一名专业的生图提示词工程师，擅长把故事节拍转化成精确的英文场景描述。',
    '你的任务：为每个桥段的 4 个 beat 生成英文 scene-specific 描述。',
    'scene-specific 是指除了锁定元素（角色外貌/画风/色调/光线）之外，这张图独有的内容：',
    '  - 角色在做什么具体动作',
    '  - 画面构图和视觉焦点',
    '  - 环境细节和氛围',
    '  - 镜头感和景深',
    '',
    '注意：',
    '  - 不要重复描述角色外貌（那已经在锁定元素里）',
    '  - 每个 scene-specific 应该 20-40 个单词',
    '  - 使用具体的视觉语言，不要抽象表达',
    '  - 确保同一桥段的 4 张图有叙事逻辑：open → develop → peak → close',
    '只输出严格 JSON 数组，格式：[[beat0,beat1,beat2,beat3], [beat0,...], ...]',
    '外层数组对应每个桥段，内层数组对应该桥段的 4 个 beat。',
  ].join('\n');

  const segmentsDesc = outline.segments.map((seg, si) => {
    const beats = seg.beats.map((b, bi) =>
      `    beat${bi}: ${b.narrative} (shot: ${b.shotType}, action: ${b.actionKeyword})`
    ).join('\n');
    return `  Segment ${si} "${seg.title}" - env: ${seg.environmentKeyword}\n${beats}`;
  }).join('\n');

  const user = [
    `故事：${outline.title}`,
    `梗概：${outline.logline}`,
    `主角：${outline.characters.map(c => `${c.name}（${c.visualDescriptionZh}）`).join('；')}`,
    '',
    '各桥段节拍：',
    segmentsDesc,
    '',
    `请为每个桥段的每个 beat 生成英文 scene-specific 描述。`,
    `共 ${outline.segments.length} 个桥段，每个 4 个 beat，输出 ${outline.segments.length} 个子数组。`,
    '格式：JSON 数组，每个元素是长度为 4 的字符串数组。',
  ].join('\n');

  const res = await proxyFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.85 },
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Gemini storyboard 失败 HTTP ${res.status}: ${text.slice(0, 300)}`);

  const payload = JSON.parse(text) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const output = payload.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || '';
  if (!output) throw new Error('模型未返回内容');

  const parsed = JSON.parse(stripFence(output)) as unknown[][];
  return parsed.map(seg =>
    Array.isArray(seg) ? seg.map(b => String(b || '').trim()) : ['', '', '', '']
  );
}

// ─── 兜底：基于 outline 直接构建 scene-specific ─────────────────────────────

function buildFallbackSpecifics(outline: StoryOutline): string[][] {
  return outline.segments.map(seg =>
    seg.beats.map(beat =>
      `${beat.shotType}, character ${beat.actionKeyword} in ${seg.environmentKeyword}, with emotional atmosphere and cinematic depth`
    )
  );
}

// ─── 主函数：把 outline + specifics 合并成完整 prompt ────────────────────────

function assembleStoryboard(outline: StoryOutline, specifics: string[][]): StoryboardSegment[] {
  const lockHeader = buildLockHeader(outline.visualLock, outline.characters);
  let globalIndex = 0;

  return outline.segments.map((seg, si) => {
    const segSpecifics = specifics[si] ?? ['', '', '', ''];
    const scenes: StoryScene[] = seg.beats.map((beat, bi) => {
      const specific = segSpecifics[bi] || `${beat.shotType}, ${beat.actionKeyword}`;
      const prompt = buildScenePrompt(lockHeader, seg, bi, specific);
      return {
        segmentIndex: si,
        beatIndex: bi,
        globalIndex: globalIndex++,
        narrative: beat.narrative,
        prompt,
      };
    });
    return {
      segmentIndex: si,
      title: seg.title,
      narrative: seg.narrative,
      scenes,
    };
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { outline?: StoryOutline };
    const outline = body.outline;
    if (!outline?.segments?.length) {
      return NextResponse.json({ error: '缺少 outline' }, { status: 400 });
    }

    let specifics: string[][];
    try {
      specifics = await generateSceneSpecifics(outline);
      // 补齐不足的 segment
      while (specifics.length < outline.segments.length) {
        const si = specifics.length;
        specifics.push(buildFallbackSpecifics(outline)[si] ?? ['', '', '', '']);
      }
    } catch {
      specifics = buildFallbackSpecifics(outline);
    }

    const segments = assembleStoryboard(outline, specifics);
    const totalScenes = segments.reduce((sum, s) => sum + s.scenes.length, 0);

    return NextResponse.json({ segments, totalScenes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
