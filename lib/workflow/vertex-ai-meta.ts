import type { VertexAIParams } from './types';

export type VertexCapability = VertexAIParams['capability'];

export interface VertexCapabilityMeta {
  label: string;
  desc: string;
  defaultModel: string;
  defaultOutputVar: string;
  defaultOutputListVar: string;
  promptTemplates: string[];
  promptScaffold: string[];
}

export interface VertexModelMeta {
  id: string;
  label: string;
  capability: VertexCapability[];
  summary: string;
  costTier: '低' | '中' | '高';
  speed: '快' | '中' | '慢';
  quality: '标准' | '高' | '旗舰';
  strengths: string[];
  note?: string;
}

export const VERTEX_CAPABILITY_META: Record<VertexCapability, VertexCapabilityMeta> = {
  image_generate: {
    label: '文生图',
    desc: '适合从一句提示词直接生成广告图、封面图、商品图。',
    defaultModel: 'vertex:imagen-4.0-generate-001',
    defaultOutputVar: 'imageUrl',
    defaultOutputListVar: 'imageUrls',
    promptTemplates: [
      'A cinematic product photo of a premium skincare bottle on travertine stone, soft daylight, shallow depth of field, luxury campaign style, ultra detailed',
      'A clean food commercial shot of iced coffee on a wooden table, morning sunlight, crisp highlights, premium cafe branding, editorial photography',
      'A fashion campaign portrait of a confident young woman in an art gallery, dramatic rim light, editorial styling, realistic skin texture, high-end magazine aesthetic',
      '一张高级品牌广告图，主体居中，背景干净有层次，电影级布光，质感清晰，适合做封面主视觉',
    ],
    promptScaffold: ['主体', '场景', '风格', '镜头', '光线', '质感'],
  },
  image_edit: {
    label: '参考图编辑',
    desc: '基于参考图定向修改，适合换背景、换道具、统一视觉风格。',
    defaultModel: 'vertex:imagen-3.0-capability-001',
    defaultOutputVar: 'imageUrl',
    defaultOutputListVar: 'imageUrls',
    promptTemplates: [
      'Keep the main subject and composition from image [1], replace the background with a clean luxury studio scene, add soft directional lighting, preserve realistic texture',
      'Use image [1] as the reference, keep the character identity unchanged, switch to a sunset seaside environment, richer color contrast, cinematic atmosphere',
      '基于参考图[1]保留主体和构图，只调整背景与道具为高级电商场景，整体更干净、更有品牌感',
      '基于参考图[1]保留人物脸部和动作，只升级服装质感、灯光和背景层次，使其更像专业广告海报',
    ],
    promptScaffold: ['保留什么', '修改什么', '新场景', '风格方向', '不要改什么'],
  },
  video_generate: {
    label: '生视频',
    desc: '适合镜头运动、角色动作、产品展示短片，输出视频结果。',
    defaultModel: 'vertex:veo-3.1-generate-001',
    defaultOutputVar: 'videoUrl',
    defaultOutputListVar: 'videoUrls',
    promptTemplates: [
      'A cinematic tracking shot around a luxury perfume bottle, subtle fog, moving reflections, elegant camera orbit, premium commercial quality',
      'A cute orange cat walking through a cozy living room, soft morning sun, gentle camera push-in, animated but realistic fur movement',
      '一段高级广告短片：主体缓慢运动，镜头平滑推进，光影变化自然，整体具有电影预告片质感',
      'Create a short product reveal video, dramatic camera dolly, layered lighting, rich depth, premium brand storytelling mood',
    ],
    promptScaffold: ['主体动作', '镜头运动', '场景变化', '光线氛围', '时长', '画幅'],
  },
};

export const VERTEX_MODEL_META: VertexModelMeta[] = [
  {
    id: 'vertex:imagen-4.0-generate-001',
    label: 'Imagen 4',
    capability: ['image_generate'],
    summary: '通用高质量文生图，适合主视觉、广告图、封面图。',
    costTier: '高',
    speed: '中',
    quality: '旗舰',
    strengths: ['画面完成度高', '质感稳定', '适合品牌图'],
    note: '实际费用以 Vertex AI 账单为准。',
  },
  {
    id: 'vertex:imagen-4.0-fast-generate-001',
    label: 'Imagen 4 Fast',
    capability: ['image_generate'],
    summary: '更快出图，适合批量试风格、快速打样。',
    costTier: '中',
    speed: '快',
    quality: '高',
    strengths: ['响应更快', '适合探索方向', '成本更友好'],
    note: '适合先试图，再切高质量模型定稿。',
  },
  {
    id: 'vertex:imagen-3.0-generate-002',
    label: 'Imagen 3',
    capability: ['image_generate'],
    summary: '成熟稳定的文生图模型，适合通用场景。',
    costTier: '中',
    speed: '中',
    quality: '高',
    strengths: ['稳定', '兼容性好', '适合常规图像生成'],
  },
  {
    id: 'vertex:imagen-3.0-capability-001',
    label: 'Imagen Edit',
    capability: ['image_edit'],
    summary: '参考图编辑模型，适合基于现有图做定向修改。',
    costTier: '中',
    speed: '中',
    quality: '高',
    strengths: ['能保留参考图主体', '适合换背景换道具', '适合统一视觉'],
    note: '参考图越清晰、修改描述越具体，结果越稳。',
  },
  {
    id: 'vertex:veo-3.1-generate-001',
    label: 'Veo 3.1',
    capability: ['video_generate'],
    summary: '旗舰级视频生成，适合高质量镜头运动与叙事片段。',
    costTier: '高',
    speed: '慢',
    quality: '旗舰',
    strengths: ['镜头语言更丰富', '动作连续性更好', '适合正式成片'],
    note: '生成耗时通常更长。',
  },
  {
    id: 'vertex:veo-3.0-generate-001',
    label: 'Veo 3',
    capability: ['video_generate'],
    summary: '稳定的视频生成模型，适合多数标准短视频场景。',
    costTier: '高',
    speed: '中',
    quality: '高',
    strengths: ['质量稳定', '适合标准短片', '镜头表现均衡'],
  },
  {
    id: 'vertex:veo-3.0-fast-generate-001',
    label: 'Veo 3 Fast',
    capability: ['video_generate'],
    summary: '更快出视频，适合验证 prompt 和镜头方向。',
    costTier: '中',
    speed: '快',
    quality: '标准',
    strengths: ['出片更快', '适合快速试验', '适合前期探索'],
  },
  {
    id: 'vertex:veo-2.0-generate-001',
    label: 'Veo 2',
    capability: ['video_generate'],
    summary: '兼容型视频模型，适合保守场景或旧流程迁移。',
    costTier: '中',
    speed: '中',
    quality: '标准',
    strengths: ['兼容旧配置', '行为稳定', '适合保底链路'],
  },
];

const ALL_VERTEX_PROMPTS = Object.values(VERTEX_CAPABILITY_META).flatMap(meta => meta.promptTemplates);

export function getVertexModelsForCapability(capability: VertexCapability): VertexModelMeta[] {
  return VERTEX_MODEL_META.filter(item => item.capability.includes(capability));
}

export function getVertexModelMeta(modelId: string): VertexModelMeta | undefined {
  return VERTEX_MODEL_META.find(item => item.id === modelId);
}

export function getDefaultVertexPrompt(capability: VertexCapability): string {
  const templates = VERTEX_CAPABILITY_META[capability].promptTemplates;
  return templates[Math.floor(Math.random() * templates.length)] ?? '';
}

export function isBuiltInVertexPrompt(prompt: string): boolean {
  return ALL_VERTEX_PROMPTS.includes(prompt.trim());
}

