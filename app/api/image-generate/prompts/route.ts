import { NextRequest, NextResponse } from 'next/server';

interface StoryBible {
  title: string;
  overview: string;
  world: string;
  protagonist: string;
  supportingCast: string;
  visualStyle: string;
  continuityRules: string[];
}

interface StoryScene {
  id: string;
  index: number;
  title: string;
  paragraph: string;
  storyBeat: string;
  prompt: string;
  negativePrompt: string;
  styleNotes: string;
  continuityNotes: string;
}

function stripMarkdownFence(text: string) {
  const raw = text.trim();
  if (!raw.startsWith('```')) return raw;
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
}

function toStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item || '').trim()).filter(Boolean);
}

function compactText(input: string) {
  return input.replace(/\s+/g, ' ').trim();
}

function normalizeBible(input: unknown, theme: string, style: string): StoryBible {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const continuityRules = toStringList(raw.continuityRules);
  return {
    title: String(raw.title || `${theme} · 连续插画故事`).trim(),
    overview: String(raw.overview || `${theme} 主题的连续插画短篇，统一视觉风格为 ${style}。`).trim(),
    world: String(raw.world || `${theme} 世界观，强调空间氛围、情绪递进和镜头统一性。`).trim(),
    protagonist: String(raw.protagonist || '一个有明确外貌锚点和成长弧线的主角。').trim(),
    supportingCast: String(raw.supportingCast || '若干推动情节的配角与环境角色。').trim(),
    visualStyle: String(raw.visualStyle || `${style}，高细节，高完成度，适合连续绘本插画。`).trim(),
    continuityRules:
      continuityRules.length > 0
        ? continuityRules
        : [
            '主角外观、服装主色和关键道具在所有分镜中保持一致',
            '每张图都直接写明统一插画风格与材质语言',
            '连续性依赖显式锚点，不依赖上下文记忆',
          ],
  };
}

function buildFinalImagePrompt(input: {
  sceneTitle: string;
  storyBeat: string;
  bible: StoryBible;
  style: string;
  extra: string;
  index: number;
}) {
  const cameraAngles = [
    'cinematic wide shot',
    'medium shot with a clear subject-environment relationship',
    'low-angle cinematic composition',
    'intimate close shot with shallow depth of field',
    'top-down storybook composition',
  ];
  const lights = [
    'soft morning mist light',
    'golden sunset rim light',
    'dreamy moonlight with glowing particles',
    'rain-washed reflective atmosphere',
    'volumetric light through haze',
  ];
  const compositions = [
    'strong focal subject with layered foreground and background',
    'balanced composition with elegant negative space',
    'hero-centered editorial framing',
    'rich environmental storytelling with clear hierarchy',
    'storybook cover quality composition',
  ];

  return compactText(
    [
      `${input.sceneTitle}, ${input.storyBeat}`,
      `primary subject: ${input.bible.protagonist}`,
      `supporting elements: ${input.bible.supportingCast}`,
      `environment: ${input.bible.world}`,
      `visual anchors: ${input.bible.continuityRules.join(', ')}`,
      `camera: ${cameraAngles[input.index % cameraAngles.length]}`,
      `lighting: ${lights[input.index % lights.length]}`,
      `composition: ${compositions[input.index % compositions.length]}`,
      `style: ${input.bible.visualStyle}, ${input.style}`,
      'high quality image generation prompt, premium illustration, highly detailed, crisp focus, refined textures, cinematic lighting, rich atmosphere, professional color grading',
      input.extra ? `extra constraints: ${input.extra}` : '',
    ]
      .filter(Boolean)
      .join(', ')
  );
}

function normalizeScene(input: unknown, index: number, bible: StoryBible, style: string): StoryScene {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const title = String(raw.title || `场景 ${index + 1}`).trim();
  const paragraph = String(raw.paragraph || raw.storyBeat || `${bible.title} 的第 ${index + 1} 个剧情段落`).trim();
  const storyBeat = String(raw.storyBeat || paragraph).trim();
  const continuityNotes = String(
    raw.continuityNotes ||
      '角色外观、服装、关键道具和主色调需要直接写进每条最终英文 prompt，确保每个子任务无状态。'
  ).trim();
  const styleNotes = String(
    raw.styleNotes ||
      '最终 prompt 必须是可直接提交给 Gemini 生图的英文提示词，强调主体、构图、镜头、光线、材质和高质量要求。'
  ).trim();
  const negativePrompt = String(
    raw.negativePrompt ||
      'low resolution, blurry, distorted face, malformed hands, extra fingers, bad anatomy, duplicate subject, cluttered composition, poor lighting, watermark, logo, text'
  ).trim();
  const prompt = String(
    raw.prompt ||
      buildFinalImagePrompt({
        sceneTitle: title,
        storyBeat,
        bible,
        style,
        extra: '',
        index,
      })
  ).trim();

  return {
    id: String(raw.id || `scene-${index + 1}`).trim(),
    index,
    title,
    paragraph,
    storyBeat,
    prompt,
    negativePrompt,
    styleNotes,
    continuityNotes,
  };
}

function fallbackStoryPackage(theme: string, style: string, count: number, extra: string) {
  const bible = normalizeBible(
    {
      title: `${theme} · 童话插画故事`,
      overview: `围绕“${theme}”展开一段连续的图像故事，从开端、探索、冲突到收束，适合批量生成一组风格统一的插图。`,
      world: `一个具有童话质感和电影化空间层次的 ${theme} 世界，环境细节丰富，具有季节、天气、光影变化。`,
      protagonist: 'a young traveler with a stable hairstyle, signature outfit color, and one recognizable prop',
      supportingCast: 'supporting creatures, guiding spirits, and environmental props that reinforce the scene',
      visualStyle: `${style}，high-end storybook illustration, premium composition, stable character design`,
      continuityRules: [
        'same hairstyle and face silhouette in every image',
        'same outfit color palette and signature prop in every image',
        'same premium storybook rendering style in every image',
      ],
    },
    theme,
    style
  );

  const beats = [
    '故事开场，主角第一次进入这个世界',
    '主角在环境中探索并发现线索',
    '主角遇到关键配角，情绪发生转折',
    '冲突升级，主角面对阻碍或谜题',
    '主角完成选择或突破，世界氛围改变',
    '结尾收束，留下余韵和视觉记忆点',
  ];

  const scenes: StoryScene[] = Array.from({ length: count }, (_, index) => {
    const beat = beats[index] || `故事的第 ${index + 1} 个关键段落`;
    const title = index === 0 ? '故事序章' : index === count - 1 ? '余韵结尾' : `分镜 ${index + 1}`;
    return normalizeScene(
      {
        id: `scene-${index + 1}`,
        title,
        paragraph: beat,
        storyBeat: beat,
        prompt: buildFinalImagePrompt({ sceneTitle: title, storyBeat: beat, bible, style, extra, index }),
        negativePrompt:
          'low resolution, blurry, bad anatomy, malformed hands, extra fingers, duplicate character, weak composition, flat lighting, watermark, logo, text, collage artifacts',
        styleNotes: '最终输出的是英文生图 prompt，不是背景说明。',
        continuityNotes: '连续性必须通过显式锚点注入到每条 prompt 中，不能依赖前文。',
      },
      index,
      bible,
      style
    );
  });

  return { bible, scenes };
}

async function callGeminiStoryPrompts(input: {
  theme: string;
  style: string;
  count: number;
  extra: string;
  currentBible?: StoryBible;
  currentScenes?: StoryScene[];
  targetSceneIndex?: number;
}) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    if (typeof input.targetSceneIndex === 'number' && input.currentBible) {
      const sceneIndex = input.targetSceneIndex;
      const fallback = fallbackStoryPackage(input.theme, input.style, input.count, input.extra);
      const baseScene = input.currentScenes?.[sceneIndex];
      const title = baseScene?.title || fallback.scenes[sceneIndex]?.title || `分镜 ${sceneIndex + 1}`;
      const beat = baseScene?.storyBeat || fallback.scenes[sceneIndex]?.storyBeat || `故事的第 ${sceneIndex + 1} 个段落`;
      return {
        bible: input.currentBible,
        scene: normalizeScene(
          {
            id: baseScene?.id || `scene-${sceneIndex + 1}`,
            title,
            paragraph: beat,
            storyBeat: beat,
            prompt: buildFinalImagePrompt({
              sceneTitle: title,
              storyBeat: beat,
              bible: input.currentBible,
              style: input.style,
              extra: input.extra,
              index: sceneIndex,
            }),
            negativePrompt: baseScene?.negativePrompt,
            styleNotes: baseScene?.styleNotes,
            continuityNotes: baseScene?.continuityNotes,
          },
          sceneIndex,
          input.currentBible,
          input.style
        ),
      };
    }
    return fallbackStoryPackage(input.theme, input.style, input.count, input.extra);
  }

  const model = String(process.env.IMAGE_PROMPT_MODEL || 'gemini-2.5-flash').trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const system = [
    '你是顶级儿童绘本与商业插画的视觉导演，同时也是高级提示词工程师。',
    '你的任务是先构建故事，再把每个分镜压缩成可直接提交给 Gemini 生图的最终英文提示词。',
    '每个分镜都是无状态图片任务，不能依赖前文记忆，必须在单条 prompt 中写清主体、环境、镜头、光线、构图、材质、风格和高质量要求。',
    '角色连续性不能靠上下文，而要靠每条 prompt 中显式写入角色外观、服装、道具、主色和风格锚点。',
    'paragraph 和 storyBeat 用中文，prompt 和 negativePrompt 必须用英文。',
    '只输出严格 JSON，不要 markdown，不要解释。',
  ].join('\n');

  const user =
    typeof input.targetSceneIndex === 'number' && input.currentBible
      ? [
          `请只重写第 ${input.targetSceneIndex + 1} 个分镜提示词。`,
          `主题：${input.theme}`,
          `风格：${input.style}`,
          `补充要求：${input.extra || '无'}`,
          `故事设定：${JSON.stringify(input.currentBible)}`,
          `现有分镜：${JSON.stringify(input.currentScenes || [])}`,
          '要求：只重写这一张图的最终英文生图 prompt，让它成为无状态、可直接提交给 Gemini 的高质量图片任务。',
          '要求：prompt 中必须显式包含角色锚点、服装、道具、环境、构图、镜头、光线、材质和高质量描述，不能写成背景介绍。',
          '输出格式严格为 JSON：{"scene":{"id":"","title":"","paragraph":"","storyBeat":"","prompt":"","negativePrompt":"","styleNotes":"","continuityNotes":""}}',
        ].join('\n')
      : [
          `请围绕主题“${input.theme}”生成一个适合连续插画创作的短篇童话/奇幻故事，并拆成 ${input.count} 个情节段落。`,
          `风格方向：${input.style}`,
          `补充要求：${input.extra || '无'}`,
          '要求：先生成统一故事设定，再输出按剧情推进的分镜。',
          '每个分镜都要包含中文剧情摘要 paragraph，以及一个最终英文生图 prompt。',
          '这个 prompt 必须是无状态的独立图片任务，不要写成剧情背景说明；要直接告诉 Gemini 生成什么图。',
          '每条英文 prompt 必须显式包含：主体外观、服装/道具锚点、场景环境、构图、镜头、光线、材质、高质量要求和风格说明。',
          'negativePrompt 也请输出英文。',
          '输出格式严格为 JSON：{"bible":{"title":"","overview":"","world":"","protagonist":"","supportingCast":"","visualStyle":"","continuityRules":[""]},"scenes":[{"id":"scene-1","title":"","paragraph":"","storyBeat":"","prompt":"","negativePrompt":"","styleNotes":"","continuityNotes":""}]}',
        ].join('\n');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.8 },
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

  const cleaned = stripMarkdownFence(output);
  const parsed = JSON.parse(cleaned) as {
    bible?: unknown;
    scenes?: unknown[];
    scene?: unknown;
  };

  if (typeof input.targetSceneIndex === 'number' && input.currentBible) {
    const scene = normalizeScene(parsed.scene, input.targetSceneIndex, input.currentBible, input.style);
    return { bible: input.currentBible, scene };
  }

  const bible = normalizeBible(parsed.bible, input.theme, input.style);
  const scenes = Array.isArray(parsed.scenes)
    ? parsed.scenes.slice(0, input.count).map((scene, index) => normalizeScene(scene, index, bible, input.style))
    : [];

  if (scenes.length === 0) {
    throw new Error('模型未返回有效分镜提示词');
  }

  return { bible, scenes };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const theme = String(body.theme || '').trim();
    const style = String(body.style || '').trim();
    const extra = String(body.extra || '').trim();
    const countRaw = Number(body.count ?? 4);
    const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(10, Math.floor(countRaw))) : 4;
    const targetSceneIndex =
      body.targetSceneIndex === undefined || body.targetSceneIndex === null
        ? undefined
        : Math.max(0, Number(body.targetSceneIndex) || 0);
    const currentBible = body.currentBible ? normalizeBible(body.currentBible, theme, style) : undefined;
    const currentScenes = Array.isArray(body.currentScenes)
      ? body.currentScenes.map((scene: unknown, index: number) =>
          normalizeScene(scene, index, currentBible || normalizeBible({}, theme, style), style)
        )
      : undefined;

    if (!theme) return NextResponse.json({ error: 'theme 不能为空' }, { status: 400 });
    if (!style) return NextResponse.json({ error: 'style 不能为空' }, { status: 400 });

    try {
      const result = await callGeminiStoryPrompts({
        theme,
        style,
        count,
        extra,
        currentBible,
        currentScenes,
        targetSceneIndex,
      });

      if (typeof targetSceneIndex === 'number' && 'scene' in result) {
        return NextResponse.json({
          theme,
          style,
          mode: 'scene-refresh',
          scene: result.scene,
          prompt: result.scene.prompt,
        });
      }

      if (!('scenes' in result)) {
        throw new Error('模型未返回分镜列表');
      }

      return NextResponse.json({
        theme,
        style,
        count: result.scenes.length,
        mode: 'story',
        bible: result.bible,
        scenes: result.scenes,
        prompts: result.scenes.map((scene) => scene.prompt),
      });
    } catch {
      if (typeof targetSceneIndex === 'number' && currentBible) {
        const sceneIndex = targetSceneIndex;
        const baseScene = currentScenes?.[sceneIndex];
        const scene = normalizeScene(
          {
            id: baseScene?.id || `scene-${sceneIndex + 1}`,
            title: baseScene?.title || `分镜 ${sceneIndex + 1}`,
            paragraph: baseScene?.paragraph || `故事的第 ${sceneIndex + 1} 个段落`,
            storyBeat: baseScene?.storyBeat || baseScene?.paragraph || `故事的第 ${sceneIndex + 1} 个段落`,
            prompt: buildFinalImagePrompt({
              sceneTitle: baseScene?.title || `分镜 ${sceneIndex + 1}`,
              storyBeat: baseScene?.storyBeat || baseScene?.paragraph || `故事的第 ${sceneIndex + 1} 个段落`,
              bible: currentBible,
              style,
              extra,
              index: sceneIndex,
            }),
            negativePrompt: baseScene?.negativePrompt,
            styleNotes: baseScene?.styleNotes,
            continuityNotes: baseScene?.continuityNotes,
          },
          sceneIndex,
          currentBible,
          style
        );
        return NextResponse.json({ theme, style, mode: 'scene-refresh', scene, prompt: scene.prompt });
      }

      const fallback = fallbackStoryPackage(theme, style, count, extra);
      return NextResponse.json({
        theme,
        style,
        count: fallback.scenes.length,
        mode: 'story',
        bible: fallback.bible,
        scenes: fallback.scenes,
        prompts: fallback.scenes.map((scene) => scene.prompt),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
