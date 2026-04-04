import fs from 'fs/promises';
import path from 'path';
import { GoogleAuth } from 'google-auth-library';
import type { Page } from 'playwright';
import { uploadBuffer } from '@/lib/oss';
import type { NodeResult, VertexAIParams, WorkflowContext } from '../types';

let cachedVertexToken = '';
let cachedVertexTokenExpiry = 0;

function getVertexProjectId(): string {
  const value = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  if (!value) throw new Error('缺少环境变量 VERTEX_PROJECT_ID（或 GOOGLE_CLOUD_PROJECT）');
  return value;
}

function getVertexLocation(): string {
  const value = process.env.VERTEX_LOCATION || process.env.GOOGLE_CLOUD_LOCATION;
  if (!value) throw new Error('缺少环境变量 VERTEX_LOCATION（或 GOOGLE_CLOUD_LOCATION）');
  return value;
}

async function getVertexAccessToken(): Promise<string> {
  if (cachedVertexToken && Date.now() < cachedVertexTokenExpiry - 5 * 60 * 1000) {
    return cachedVertexToken;
  }

  const keyFile = process.env.VERTEX_CREDENTIALS_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFile) {
    throw new Error('缺少环境变量 VERTEX_CREDENTIALS_FILE（或 GOOGLE_APPLICATION_CREDENTIALS）');
  }

  await fs.access(keyFile);

  const auth = new GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse.token) throw new Error('获取 Vertex access token 失败');

  cachedVertexToken = tokenResponse.token;
  cachedVertexTokenExpiry = Date.now() + 50 * 60 * 1000;
  return cachedVertexToken;
}

function parseReferenceUrls(raw: string | undefined): string[] {
  const text = String(raw ?? '').trim();
  if (!text) return [];

  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map(item => String(item).trim()).filter(Boolean);
      }
    } catch {
      // fallback below
    }
  }

  return text
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function ensureVertexModel(model: string, capability: VertexAIParams['capability']): string {
  const normalized = model.startsWith('vertex:') ? model.slice('vertex:'.length) : model;
  if (!normalized) {
    if (capability === 'video_generate') return 'veo-3.1-generate-001';
    if (capability === 'image_edit') return 'imagen-3.0-capability-001';
    return 'imagen-4.0-generate-001';
  }
  return normalized;
}

function clampImageCount(count: number, log: string[]): number {
  const safe = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  if (safe > 4) {
    log.push('⚠️ Vertex Imagen 最多 4 张，已自动改为 4 张');
  }
  return Math.min(safe, 4);
}

function buildOssKey(template: string, index: number, ext: string): string {
  const timestamp = String(Date.now());
  const key = template
    .replace(/\{\{timestamp\}\}/g, timestamp)
    .replace(/\{\{index\}\}/g, String(index));

  if (/\.[a-zA-Z0-9]+$/.test(key)) return key;
  return `${key}.${ext}`;
}

function buildReferencePrompt(prompt: string): string {
  const finalPrompt = prompt.trim();
  if (!finalPrompt) return 'Transform the subject in image [1] while preserving the main subject.';
  if (finalPrompt.includes('[1]')) return finalPrompt;
  return /[\u4E00-\u9FFF]/.test(finalPrompt)
    ? `基于参考图[1]，${finalPrompt}`
    : `Using image [1], ${finalPrompt}`;
}

async function fetchReferenceImage(url: string): Promise<{ bytesBase64Encoded: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载参考图失败 (${response.status}): ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  const mimeType = contentType
    || (ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png');

  return {
    bytesBase64Encoded: buffer.toString('base64'),
    mimeType,
  };
}

async function vertexPredict(model: string, body: unknown, token: string): Promise<unknown> {
  const projectId = getVertexProjectId();
  const location = getVertexLocation();
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Vertex 请求失败 (${response.status}): ${text}`);
  }
  return JSON.parse(text) as unknown;
}

async function vertexPredictLongRunning(model: string, body: unknown, token: string): Promise<string> {
  const projectId = getVertexProjectId();
  const location = getVertexLocation();
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predictLongRunning`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Vertex 长任务请求失败 (${response.status}): ${text}`);
  }

  const parsed = JSON.parse(text) as { name?: string };
  if (!parsed.name) throw new Error(`Vertex 未返回 operation name: ${text}`);
  return parsed.name;
}

function vertexModelPathFromOperationName(operationName: string): string {
  const marker = '/operations/';
  const index = operationName.indexOf(marker);
  if (index === -1) throw new Error(`非法的 Vertex operation name: ${operationName}`);
  return operationName.slice(0, index);
}

async function pollVideoOperation(operationName: string, token: string, log: string[]): Promise<string[]> {
  const modelPath = vertexModelPathFromOperationName(operationName);
  const endpoint = `https://aiplatform.googleapis.com/v1/${modelPath}:fetchPredictOperation`;

  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10_000));
    log.push(`⏳ 等待 Vertex 视频生成完成... (${attempt + 1}/60)`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ operationName }),
    });

    const text = await response.text();
    if (!response.ok) continue;

    const parsed = JSON.parse(text) as {
      done?: boolean;
      error?: { message?: string };
      response?: Record<string, unknown>;
    };

    if (!parsed.done) continue;
    if (parsed.error?.message) throw new Error(parsed.error.message);

    const urls = collectVideoArtifacts(parsed.response ?? {});
    if (urls.length === 0) {
      throw new Error(`Vertex 视频任务完成但未返回产物: ${text}`);
    }
    return urls;
  }

  throw new Error('Vertex 视频生成超时（10 分钟）');
}

function collectVideoArtifacts(payload: Record<string, unknown>): string[] {
  const urls: string[] = [];

  const appendFromVideo = (video: Record<string, unknown>) => {
    const b64 = typeof video.bytesBase64Encoded === 'string' ? video.bytesBase64Encoded : '';
    if (b64) {
      urls.push(`data:video/mp4;base64,${b64}`);
      return;
    }
    const gcsUri = typeof video.gcsUri === 'string' ? video.gcsUri : '';
    if (gcsUri) {
      urls.push(gcsUri);
      return;
    }
    const uri = typeof video.uri === 'string' ? video.uri : '';
    if (uri) urls.push(uri);
  };

  const videos = Array.isArray(payload.videos) ? payload.videos : [];
  for (const item of videos) {
    if (item && typeof item === 'object') appendFromVideo(item as Record<string, unknown>);
  }

  const predictions = Array.isArray(payload.predictions) ? payload.predictions : [];
  for (const item of predictions) {
    if (!item || typeof item !== 'object') continue;
    const prediction = item as Record<string, unknown>;
    const gcsUri = typeof prediction.gcsUri === 'string' ? prediction.gcsUri : '';
    if (gcsUri) urls.push(gcsUri);
    const nestedVideos = Array.isArray(prediction.videos) ? prediction.videos : [];
    for (const video of nestedVideos) {
      if (video && typeof video === 'object') appendFromVideo(video as Record<string, unknown>);
    }
  }

  return urls;
}

function gcsUriToHttps(uri: string): string {
  return uri.startsWith('gs://') ? `https://storage.googleapis.com/${uri.slice(5)}` : uri;
}

async function downloadVertexVideoArtifact(uri: string, token: string): Promise<Buffer> {
  if (uri.startsWith('data:video/')) {
    const base64 = uri.slice(uri.indexOf(',') + 1);
    return Buffer.from(base64, 'base64');
  }

  const response = await fetch(gcsUriToHttps(uri), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`下载 Vertex 视频失败 (${response.status}): ${uri}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function executeImageGenerate(params: VertexAIParams, token: string, log: string[]) {
  const model = ensureVertexModel(params.model, 'image_generate');
  const count = clampImageCount(Number(params.count ?? 1), log);

  const parsed = await vertexPredict(model, {
    instances: [{ prompt: params.prompt }],
    parameters: {
      sampleCount: count,
      aspectRatio: params.aspectRatio || '1:1',
      safetyFilterLevel: 'block_some',
      personGeneration: params.personGeneration || 'allow_adult',
      enhancePrompt: false,
    },
  }, token) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  };

  const predictions = parsed.predictions ?? [];
  return predictions
    .filter(item => item.bytesBase64Encoded)
    .map(item => ({
      bytes: Buffer.from(item.bytesBase64Encoded!, 'base64'),
      mimeType: item.mimeType || 'image/png',
      ext: 'png',
    }));
}

async function executeImageEdit(params: VertexAIParams, token: string, log: string[]) {
  const model = ensureVertexModel(params.model, 'image_edit');
  const count = clampImageCount(Number(params.count ?? 1), log);
  const urls = parseReferenceUrls(params.referenceImageUrls);
  if (urls.length === 0) {
    throw new Error('参考图编辑至少需要 1 张 referenceImageUrls');
  }

  log.push(`🖼️ 正在下载 ${urls.length} 张参考图...`);
  const references = await Promise.all(urls.map(url => fetchReferenceImage(url)));

  const parsed = await vertexPredict(model, {
    instances: [{
      prompt: buildReferencePrompt(params.prompt),
      referenceImages: references.map((ref, index) => ({
        referenceType: 'REFERENCE_TYPE_RAW',
        referenceId: index + 1,
        referenceImage: ref,
      })),
    }],
    parameters: {
      sampleCount: count,
    },
  }, token) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  };

  const predictions = parsed.predictions ?? [];
  return predictions
    .filter(item => item.bytesBase64Encoded)
    .map(item => ({
      bytes: Buffer.from(item.bytesBase64Encoded!, 'base64'),
      mimeType: item.mimeType || 'image/png',
      ext: 'png',
    }));
}

async function executeVideoGenerate(params: VertexAIParams, token: string, log: string[]) {
  const model = ensureVertexModel(params.model, 'video_generate');
  const projectId = getVertexProjectId();
  const bucket = process.env.VERTEX_GCS_BUCKET || `${projectId}-video-output`;
  const operationName = await vertexPredictLongRunning(model, {
    instances: [{
      prompt: params.prompt,
      ...(params.sourceImageGcsUri ? { image: { gcsUri: params.sourceImageGcsUri } } : {}),
    }],
    parameters: {
      storageUri: `gs://${bucket}/veo-output/`,
      durationSeconds: Math.max(4, Math.min(8, Number(params.durationSeconds ?? 8))),
      aspectRatio: params.aspectRatio || '16:9',
      sampleCount: 1,
      generateAudio: params.generateAudio ?? true,
    },
  }, token);

  log.push(`🎬 Vertex 视频任务已创建: ${operationName}`);
  const artifacts = await pollVideoOperation(operationName, token, log);
  const buffers = await Promise.all(artifacts.map(uri => downloadVertexVideoArtifact(uri, token)));

  return buffers.map(buffer => ({
    bytes: buffer,
    mimeType: 'video/mp4',
    ext: 'mp4',
  }));
}

export async function executeVertexAI(
  _page: Page,
  params: VertexAIParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];

  try {
    const capability = params.capability ?? 'image_generate';
    const prompt = String(params.prompt ?? '').trim();
    if (!prompt) throw new Error('prompt 不能为空');

    const token = await getVertexAccessToken();
    log.push(`🏔️ Vertex AI 能力: ${capability}`);
    log.push(`📝 提示词: ${prompt}`);

    const assets =
      capability === 'video_generate'
        ? await executeVideoGenerate(params, token, log)
        : capability === 'image_edit'
          ? await executeImageEdit(params, token, log)
          : await executeImageGenerate(params, token, log);

    if (assets.length === 0) {
      throw new Error('Vertex AI 未返回任何结果');
    }

    const uploadToOSS = params.uploadToOSS ?? true;
    const outputVar = String(params.outputVar ?? (capability === 'video_generate' ? 'videoUrl' : 'imageUrl'));
    const outputListVar = String(params.outputListVar ?? (capability === 'video_generate' ? 'videoUrls' : 'imageUrls'));
    const pathTemplate = String(
      params.ossPath ?? (capability === 'video_generate' ? 'vertex-videos/{{timestamp}}-{{index}}.mp4' : 'vertex-images/{{timestamp}}-{{index}}.png')
    );

    const collected: string[] = [];
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      if (uploadToOSS) {
        const ossKey = buildOssKey(pathTemplate, i, asset.ext);
        log.push(`☁️ 正在上传第 ${i + 1} 个结果到 OSS: ${ossKey}`);
        const url = await uploadBuffer(asset.bytes, ossKey, asset.mimeType);
        collected.push(url);
        log.push(`✅ 第 ${i + 1} 个结果上传成功: ${url}`);
      } else {
        collected.push(`data:${asset.mimeType};base64,${asset.bytes.toString('base64')}`);
      }
    }

    const first = collected[0] ?? '';
    ctx.vars[outputVar] = first;
    ctx.vars[outputListVar] = JSON.stringify(collected);

    log.push(`🧩 输出变量 ${outputVar} = ${first}`);
    log.push(`🧩 输出变量 ${outputListVar} = ${JSON.stringify(collected)}`);

    return {
      success: true,
      log,
      output: {
        [outputVar]: first,
        [outputListVar]: collected,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.push(`❌ Vertex AI 节点失败: ${message}`);
    return { success: false, log, error: message };
  }
}
