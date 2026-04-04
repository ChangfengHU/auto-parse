import { getMaterialById } from '@/lib/materials';
import type { MaterialParams, NodeResult, WorkflowContext } from '../types';

export async function executeMaterial(
  _page: unknown,
  params: MaterialParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const materialId = String(params.materialId ?? '').trim();
  const outputVideoVar = String(params.outputVideoVar ?? 'videoUrl').trim() || 'videoUrl';
  const outputTitleVar = String(params.outputTitleVar ?? 'title').trim() || 'title';

  if (!materialId) {
    return {
      success: false,
      log: ['❌ 未选择素材'],
      error: '请先在素材节点中选择素材',
    };
  }

  const material = getMaterialById(materialId);
  if (!material) {
    return {
      success: false,
      log: [`❌ 素材不存在：${materialId}`],
      error: '所选素材不存在，可能已被删除',
    };
  }
  if (!material.ossUrl) {
    return {
      success: false,
      log: [`❌ 素材缺少 OSS 地址：${material.title || materialId}`],
      error: '素材缺少可发布的视频地址',
    };
  }

  ctx.vars[outputVideoVar] = material.ossUrl;
  ctx.vars[outputTitleVar] = material.title ?? '';

  return {
    success: true,
    log: [
      `📦 已选择素材：${material.title || '（无标题）'}`,
      `🧩 输出变量：${outputVideoVar}、${outputTitleVar}`,
    ],
    output: {
      materialId: material.id,
      [outputVideoVar]: material.ossUrl,
      [outputTitleVar]: material.title ?? '',
    },
  };
}
