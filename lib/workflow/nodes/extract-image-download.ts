import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { Page } from 'playwright';
import type { ExtractImageDownloadParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import { withSystemClipboardLock } from '../clipboard-lock';
import { uploadBuffer } from '../../oss';
import { normalizeFailFastAction, normalizeFailFastTextIncludes } from './fail-fast-text';
import { parseWorkflowStepErrorMessage } from '../step-error-meta';

function pickIndex(count: number, wanted: number): number {
  if (count <= 0) return -1;
  if (wanted === -1) return count - 1;
  if (wanted < 0) return 0;
  if (wanted >= count) return count - 1;
  return wanted;
}

function inferMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  return 'application/octet-stream';
}

function sniffMediaType(buffer: Buffer, fallbackName = ''): { mimeType: string; extension: string } {
  if (buffer.length >= 8) {
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return { mimeType: 'image/png', extension: '.png' };
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { mimeType: 'image/jpeg', extension: '.jpg' };
    }
    if (buffer.slice(0, 6).toString('ascii') === 'GIF87a' || buffer.slice(0, 6).toString('ascii') === 'GIF89a') {
      return { mimeType: 'image/gif', extension: '.gif' };
    }
    if (
      buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
      buffer.slice(8, 12).toString('ascii') === 'WEBP'
    ) {
      return { mimeType: 'image/webp', extension: '.webp' };
    }
    if (buffer.slice(4, 8).toString('ascii') === 'ftyp') {
      const brand = buffer.slice(8, 12).toString('ascii').toLowerCase();
      if (brand.includes('avif')) return { mimeType: 'image/avif', extension: '.avif' };
      return { mimeType: 'video/mp4', extension: '.mp4' };
    }
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
      return { mimeType: 'video/webm', extension: '.webm' };
    }
  }

  const inferred = inferMimeType(fallbackName);
  const ext = path.extname(fallbackName).toLowerCase();
  return {
    mimeType: inferred,
    extension: ext || '',
  };
}

function isSupportedMediaMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType.startsWith('video/');
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** multipart 上传到自建 files:upload，与浏览器 upload-test 行为一致（storage_backend=local） */
async function uploadBufferToLocalFilesApi(
  buffer: Buffer,
  fileName: string,
  contentType: string,
  uploadUrl: string,
  timeoutMs: number
): Promise<string> {
  const form = new FormData();
  const blob = new Blob([buffer], { type: contentType });
  form.append('file', blob, fileName);
  form.append('storage_backend', 'local');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(uploadUrl, {
      method: 'POST',
      body: form,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`响应非 JSON: ${text.slice(0, 240)}`);
    }
    const url = String(json.url ?? json.image_url ?? '').trim();
    if (!url) {
      throw new Error('响应中缺少 url / image_url');
    }
    return url;
  } finally {
    clearTimeout(timer);
  }
}

/** Gemini 英文整句失败提示（单字 error/again 会在 normalize 中被剔除，故在此默认追加） */
const DEFAULT_FAIL_FAST_EXTRA_PHRASES = ['encountered an error', 'could you try again'] as const;

function buildExtractDownloadFailFastTexts(params: ExtractImageDownloadParams): string[] {
  const normalized = normalizeFailFastTextIncludes(
    (params as { failFastTextIncludes?: unknown }).failFastTextIncludes
  );
  const hasSelector = String(params.failFastSelector || '').trim().length > 0;
  const userConfiguredFailFast = normalized.length > 0 || hasSelector;
  const merge =
    userConfiguredFailFast &&
    (params as { failFastMergeDefaultPhrases?: boolean }).failFastMergeDefaultPhrases !== false;
  const extra = merge ? [...DEFAULT_FAIL_FAST_EXTRA_PHRASES] : [];
  return Array.from(new Set([...normalized, ...extra]));
}

class FailFastError extends Error {
  readonly errorCode = 'FAIL_FAST' as const;
  readonly errorMsg: string;
  constructor(reason: string) {
    // 供上层调度器精确识别：仅 extract_image_download 的 fail-fast 才允许触发强制改写
    super(`FAIL_FAST: NODE=extract_image_download; ${reason}`);
    this.name = 'FailFastError';
    this.errorMsg = reason;
  }
}

function isFailFastError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || '');
  return message.startsWith('FAIL_FAST:');
}

async function detectVideoResult(page: Page): Promise<{ isVideo: boolean; reason?: string }> {
  try {
    return await page.evaluate(() => {
      const bodyText = document.body?.innerText?.toLowerCase() || '';
      const hasVideoElement = document.querySelector('video') !== null;
      const hasVideoText =
        bodyText.includes('your video is ready') ||
        bodyText.includes('share video') ||
        bodyText.includes('视频已就绪') ||
        bodyText.includes('分享视频');
      if (hasVideoText) {
        return { isVideo: true, reason: '页面显示视频结果文案' };
      }
      if (hasVideoElement) {
        return { isVideo: true, reason: '页面存在 video 元素' };
      }
      return { isVideo: false };
    });
  } catch {
    return { isVideo: false };
  }
}

function withExtension(filePath: string, extension: string): string {
  if (!extension) return filePath;
  const currentExt = path.extname(filePath);
  if (currentExt.toLowerCase() === extension.toLowerCase()) return filePath;
  return `${filePath.slice(0, currentExt ? -currentExt.length : undefined)}${extension}`;
}

async function readImageBufferFromPage(page: Page, src: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const payload = await page.evaluate(async (imageSrc) => {
    const toArray = async (blob: Blob, mimeType: string) => {
      const buf = await blob.arrayBuffer();
      return { mimeType, data: Array.from(new Uint8Array(buf)) };
    };

    // 1) 首选 fetch（对 http/data/blob 都快）
    try {
      const res = await fetch(imageSrc);
      if (res.ok) {
        const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
        const buf = await res.arrayBuffer();
        return { mimeType, data: Array.from(new Uint8Array(buf)) };
      }
    } catch {
      // 继续走 Canvas 兜底
    }

    // 2) fetch 失败时，尝试从已渲染的 <img> 画到 Canvas 导出
    try {
      const imgs = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];
      const target = imgs.find((img) => (img.currentSrc || img.src) === imageSrc) || imgs.find((img) => (img.currentSrc || img.src || '').includes(imageSrc));
      if (!target) return { error: 'image element not found for src' };
      if (!target.complete || !target.naturalWidth || !target.naturalHeight) {
        return { error: 'image element not ready' };
      }
      const canvas = document.createElement('canvas');
      canvas.width = target.naturalWidth;
      canvas.height = target.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return { error: 'canvas context unavailable' };
      ctx.drawImage(target, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return { error: 'canvas toBlob failed' };
      return await toArray(blob, 'image/png');
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, src);
  if ('error' in payload) throw new Error(payload.error);
  return { buffer: Buffer.from(payload.data), mimeType: payload.mimeType || 'image/png' };
}

/**
 * 优先取 model-response / generated-image 内的图（避免与输入框参考图预览混淆），再按 selector 全页兜底。
 */
async function pickBestImageSrc(page: Page, selector: string): Promise<string> {
  const src = await page.evaluate((sel) => {
    const rank = (nodes: HTMLImageElement[]) =>
      nodes
        .map((img) => {
          const rect = img.getBoundingClientRect();
          const width = img.naturalWidth || rect.width || 0;
          const height = img.naturalHeight || rect.height || 0;
          const area = Math.max(0, width) * Math.max(0, height);
          const s = img.currentSrc || img.src || '';
          return { s, area };
        })
        .filter((it) => !!it.s && it.area > 0)
        .sort((a, b) => b.area - a.area);

    const genImgs = Array.from(
      document.querySelectorAll(
        'model-response generated-image img, response-element generated-image img, generated-image img'
      )
    ) as HTMLImageElement[];
    const bestGen = rank(genImgs);
    if (bestGen[0]?.s) return bestGen[0].s;

    try {
      const nodes = Array.from(document.querySelectorAll(sel)) as HTMLImageElement[];
      const best = rank(nodes);
      return best[0]?.s || '';
    } catch {
      return '';
    }
  }, selector);
  return src || '';
}

/** 点击「复制图片」后读剪贴板（需页面已授予 clipboard-read） */
async function tryExtractViaCopyButton(
  page: Page,
  copySel: string,
  beforeClipHash: string | null,
  minFileSizeBytes: number,
  log: string[]
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const sel = copySel.trim();
  if (!sel) return null;
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const loc = page.locator(sel).first();
    await loc.waitFor({ state: 'visible', timeout: 12_000 });
    await loc.click({ timeout: 8_000 });
    await page.waitForTimeout(700);
    const clip = await readImageFromClipboard(page);
    if (!clip?.buffer.length) {
      log.push('⚠️ 复制按钮已点，剪贴板无图片');
      return null;
    }
    const h = sha256(clip.buffer);
    if (beforeClipHash && h === beforeClipHash) {
      log.push('⚠️ 复制后剪贴板与点击前相同，跳过（疑似未复制到新图）');
      return null;
    }
    if (minFileSizeBytes > 0 && clip.buffer.length < minFileSizeBytes) {
      log.push(`⚠️ 复制兜底图片过小(${clip.buffer.length} bytes)`);
      return null;
    }
    log.push(`✅ 复制按钮兜底 (${(clip.buffer.length / 1024).toFixed(1)} KB)`);
    return { buffer: clip.buffer, mimeType: clip.mimeType };
  } catch (e) {
    log.push(`⚠️ 复制按钮兜底失败: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function readImageFromClipboard(page: Page): Promise<{ buffer: Buffer; mimeType: string } | null> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const payload = await page.evaluate(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.includes('image/png')
          ? 'image/png'
          : item.types.find((t) => t.startsWith('image/'));
        if (!imgType) continue;
        const blob = await item.getType(imgType);
        const buf = await blob.arrayBuffer();
        return { mimeType: imgType, data: Array.from(new Uint8Array(buf)) };
      }
      return null;
    } catch {
      return null;
    }
  });
  if (!payload || !('data' in payload)) return null;
  return { buffer: Buffer.from(payload.data), mimeType: payload.mimeType || 'image/png' };
}


async function detectFailFast(
  page: Page,
  rules: { textIncludes: string[]; selector: string },
  timeoutMs = 300
): Promise<string | null> {
  const selector = (rules.selector || '').trim();
  if (selector) {
    const visible = await page
      .locator(selector)
      .first()
      .isVisible({ timeout: timeoutMs })
      .catch(() => false);
    if (visible) return `命中 failFastSelector: ${selector}`;
  }

  const texts = (rules.textIncludes || []).map((t) => String(t || '').trim()).filter(Boolean);
  if (texts.length > 0) {
    let bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (!bodyText) {
      bodyText = await page.locator('body').innerText({ timeout: timeoutMs }).catch(() => '');
    }
    const normalized = String(bodyText || '').toLowerCase();
    for (const t of texts) {
      if (normalized.includes(t.toLowerCase())) {
        return `命中 failFastTextIncludes: ${t}`;
      }
    }
  }

  return null;
}

export async function executeExtractImageDownload(
  page: Page,
  params: ExtractImageDownloadParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  /** 与 waitImageReady 内 emitLog 一致：长步骤也可边跑边出现在 session SSE */
  const pushLog = (msg: string) => {
    log.push(msg);
    ctx.emit?.('log', msg);
  };
  let tempDir = '';

  try {
    const selector = (params.downloadButtonSelector || [
      '[aria-label="Download image"]',
      '[aria-label*="Download"]',
      '[aria-label*="下载"]',
      'button:has-text("Download")',
      'button:has-text("下载")',
    ].join(', ')).trim();
    const buttonTimeout = params.buttonTimeout ?? 60_000;
    const downloadTimeout = params.downloadTimeout ?? 25_000;
    const maxRetries = Math.max(1, params.maxRetries ?? 2);
    const waitAfterClick = Math.max(0, params.waitAfterClick ?? 500);
    const minFileSizeBytes = Math.max(0, params.minFileSizeBytes ?? 0);
    const allowDomFallback = params.allowDomFallback ?? false;
    const allowClipboardFallback = params.allowClipboardFallback ?? true;
    const serializeClipboardAccess = params.serializeClipboardAccess ?? true;
    const menuTriggerSelector = (params.menuTriggerSelector || 'button[aria-label*="More options"], button[aria-label*="更多"]').trim();
    const menuItemSelector = (params.menuItemSelector || '[role="menuitem"]:has-text("Download"), [role="menuitem"]:has-text("下载"), button:has-text("Download"), button:has-text("下载")').trim();
    const fallbackImageSelector = (params.fallbackImageSelector || 'img[src^="blob:"], img[src^="data:image"], img').trim();
    const copyImageButtonSelector = String(params.copyImageButtonSelector ?? '').trim();
    const uploadToOSS = params.uploadToOSS ?? true;
    const useLocalApi = params.storageBackend === 'local_api';
    const useOss = !useLocalApi && uploadToOSS;
    const outputVar = params.outputVar || 'imageUrl';
    const buttonIndex = params.buttonIndex ?? -1;
    const waitForNew = params.waitForNew ?? false;
    const waitForNewTimeout = params.waitForNewTimeout ?? 120_000;
    const failFastAction = normalizeFailFastAction((params as { failFastAction?: unknown }).failFastAction);

    const failFastTextIncludes = buildExtractDownloadFailFastTexts(params);
    const failFastSelector = String(params.failFastSelector || '').trim();
    if (failFastTextIncludes.length > 0 || failFastSelector) {
      log.push(
        `🛑 失败快判已启用: ` +
          [
            failFastSelector ? `selector=${failFastSelector}` : '',
            failFastTextIncludes.length > 0 ? `textIncludes=${failFastTextIncludes.length}` : '',
            `action=${failFastAction}`,
          ]
            .filter(Boolean)
            .join(', ')
      );
    }
    let ossPath = params.ossPath || 'gemini-images/{{timestamp}}.png';
    ossPath = ossPath.replace(/\{\{timestamp\}\}/g, String(Date.now()));

    // ── fail-fast：如果页面已经明确失败文案/元素，直接报错，避免无效等待 ──────────
    {
      const reason = await detectFailFast(
        page,
        { textIncludes: failFastTextIncludes, selector: failFastSelector },
        300
      );
      if (reason) {
        log.push(`🛑 失败快判：${reason}`);
        throw new FailFastError(reason);
      }
    }

    // ── waitImageReady：等待图片生成完成 ────────────────────────────────────────────
    if (params.waitImageReady) {
      const waitTimeout = params.waitImageReadyTimeout ?? 240_000;
      const customSel = (params.waitImageReadySelector || '').trim();
      const action = ((params as { waitImageReadyAction?: string }).waitImageReadyAction || 'appeared_then_disappeared');
      const appearTimeout = ((params as { waitImageReadyAppearTimeout?: number }).waitImageReadyAppearTimeout ?? 30_000);

      const customText = ((params as { waitImageReadyText?: string }).waitImageReadyText || '').trim();
      // 优先用文字匹配，其次用选择器，两者都没有则跳过
      const getLocator = () => customText
        ? page.getByText(customText, { exact: false }).first()
        : customSel ? page.locator(customSel).first() : null;
      const matchDesc = customText ? `文字"${customText}"` : customSel ? `选择器 ${customSel}` : '';

      // 实时推送日志到 SSE（每 5s 打一次进度，不等节点结束）
      const emitLog = (msg: string) => {
        log.push(msg);
        ctx.emit?.('log', msg);
      };

      if (!matchDesc) {
        emitLog(`⚠️ waitImageReady 已启用但未配置 waitImageReadySelector 或 waitImageReadyText，跳过等待`);
      } else if (action === 'appeared_then_disappeared') {
        // 阶段一：等加载指示器出现（最多 appearTimeout）
        emitLog(`⏳ [阶段1] 等待加载指示器出现（${matchDesc}，最多 ${appearTimeout / 1000}s）`);
        const appearDeadline = Date.now() + appearTimeout;
        let appeared = false;
        let lastEmitAppear = Date.now();
        while (Date.now() < appearDeadline) {
          const reason = await detectFailFast(page, { textIncludes: failFastTextIncludes, selector: failFastSelector }, 300);
          if (reason) { emitLog(`🛑 失败快判：${reason}`); throw new FailFastError(reason); }
          const loc = getLocator();
          const visible = loc ? await loc.isVisible({ timeout: 300 }).catch(() => false) : false;
          if (visible) { appeared = true; break; }
          if (Date.now() - lastEmitAppear >= 5000) {
            emitLog(`⏳ [阶段1] 仍在等待加载指示器出现... (已等 ${Math.round((Date.now() - (appearDeadline - appearTimeout)) / 1000)}s)`);
            lastEmitAppear = Date.now();
          }
          await page.waitForTimeout(500);
        }
        emitLog(appeared ? `✅ 加载指示器已出现，进入阶段2` : `⚠️ 加载指示器未在 ${appearTimeout / 1000}s 内出现（可能已完成），直接进入阶段2`);

        // 阶段二：等加载指示器消失（最多 waitTimeout）
        emitLog(`⏳ [阶段2] 等待加载指示器消失（最多 ${waitTimeout / 1000}s）...`);
        const disappearStart = Date.now();
        const disappearDeadline = disappearStart + waitTimeout;
        let disappeared = false;
        let lastEmitDisappear = Date.now();
        while (Date.now() < disappearDeadline) {
          const reason = await detectFailFast(page, { textIncludes: failFastTextIncludes, selector: failFastSelector }, 300);
          if (reason) { emitLog(`🛑 失败快判：${reason}`); throw new FailFastError(reason); }
          const loc = getLocator();
          const visible = loc ? await loc.isVisible({ timeout: 300 }).catch(() => false) : false;
          if (!visible) { disappeared = true; break; }
          if (Date.now() - lastEmitDisappear >= 5000) {
            emitLog(`⏳ [阶段2] 图片生成中，仍在等待... (已等 ${Math.round((Date.now() - disappearStart) / 1000)}s)`);
            lastEmitDisappear = Date.now();
          }
          await page.waitForTimeout(1000);
        }
        emitLog(disappeared ? `✅ 图片生成完成，继续提取` : `⚠️ 等待加载消失超时 (${waitTimeout / 1000}s)，继续尝试`);

      } else if (action === 'appeared') {
        emitLog(`⏳ 等待元素出现（${matchDesc}，最多 ${waitTimeout / 1000}s）`);
        const appearStart = Date.now();
        const deadline = appearStart + waitTimeout;
        let done = false;
        let lastEmit = Date.now();
        while (Date.now() < deadline) {
          const reason = await detectFailFast(page, { textIncludes: failFastTextIncludes, selector: failFastSelector }, 300);
          if (reason) { emitLog(`🛑 失败快判：${reason}`); throw new FailFastError(reason); }
          const loc = getLocator();
          const visible = loc ? await loc.isVisible({ timeout: 300 }).catch(() => false) : false;
          if (visible) { done = true; break; }
          if (Date.now() - lastEmit >= 5000) {
            emitLog(`⏳ 仍在等待元素出现... (已等 ${Math.round((Date.now() - appearStart) / 1000)}s)`);
            lastEmit = Date.now();
          }
          await page.waitForTimeout(1000);
        }
        emitLog(done ? `✅ 元素已出现，继续提取` : `⚠️ 等待元素出现超时，继续尝试`);

      } else if (action === 'disappeared') {
        emitLog(`⏳ 等待元素消失（${matchDesc}，最多 ${waitTimeout / 1000}s）`);
        const disappearStart2 = Date.now();
        const deadline = disappearStart2 + waitTimeout;
        let done = false;
        let lastEmit = Date.now();
        while (Date.now() < deadline) {
          const reason = await detectFailFast(page, { textIncludes: failFastTextIncludes, selector: failFastSelector }, 300);
          if (reason) { emitLog(`🛑 失败快判：${reason}`); throw new FailFastError(reason); }
          const loc = getLocator();
          const visible = loc ? await loc.isVisible({ timeout: 300 }).catch(() => false) : false;
          if (!visible) { done = true; break; }
          if (Date.now() - lastEmit >= 5000) {
            emitLog(`⏳ 仍在等待元素消失... (已等 ${Math.round((Date.now() - disappearStart2) / 1000)}s)`);
            lastEmit = Date.now();
          }
          await page.waitForTimeout(1000);
        }
        emitLog(done ? `✅ 元素已消失，继续提取` : `⚠️ 等待元素消失超时，继续尝试`);
      }
    }

    pushLog(
      `📥 生图阶段结束 → 后续：${params.preferDomExtraction ? 'DOM 优先提取 → ' : ''}查找下载入口 / 浏览器下载事件 → 本地校验 → OSS`
    );

    // ── 提前声明（preferDomExtraction 可能提前赋值，跳过下载流程） ──────────────────
    let imageBuffer: Buffer | null = null;
    let extractionMethod: 'download' | 'dom' | 'clipboard' = 'download';
    let finalPath = '';
    let fileName = '';
    let contentType = 'application/octet-stream';

    // ── preferDomExtraction：优先从 DOM 直接 fetch，跳过浏览器下载流程 ──────────────
    if (params.preferDomExtraction) {
      pushLog(`🚀 DOM 优先提取：直接 fetch 页面图片（跳过浏览器下载）`);
      const domFallbackSel = (params.fallbackImageSelector || 'img[src^="blob:"], img[src^="data:image"], img').trim();
      const minSizeDom = Math.max(0, params.minFileSizeBytes ?? 0);
      try {
        if (copyImageButtonSelector) {
          const clipBefore = allowClipboardFallback ? await readImageFromClipboard(page).catch(() => null) : null;
          const clipBeforeHash = clipBefore?.buffer?.length ? sha256(clipBefore.buffer) : null;
          const viaCopy = await tryExtractViaCopyButton(
            page,
            copyImageButtonSelector,
            clipBeforeHash,
            minSizeDom,
            log
          );
          if (viaCopy) {
            const ffReason = await detectFailFast(
              page,
              { textIncludes: failFastTextIncludes, selector: failFastSelector },
              300
            );
            if (ffReason) {
              log.push(`🛑 失败快判（复制兜底前）：${ffReason}`);
              throw new FailFastError(ffReason);
            }
            imageBuffer = viaCopy.buffer;
            contentType = viaCopy.mimeType;
            extractionMethod = 'clipboard';
            log.push(
              `✅ DOM 优先路径：复制按钮兜底成功 (${(imageBuffer.length / 1024).toFixed(1)} KB)，跳过浏览器下载`
            );
          }
        }
        if (!imageBuffer) {
        const src = await pickBestImageSrc(page, domFallbackSel);
        if (src) {
          log.push(`🖼️ 找到图片 src: ${src.slice(0, 100)}`);
          const extracted = await readImageBufferFromPage(page, src);
          if (minSizeDom > 0 && extracted.buffer.length < minSizeDom) {
            log.push(`⚠️ DOM 优先提取过小 (${extracted.buffer.length} bytes < ${minSizeDom})，回退到下载流程`);
          } else {
            const ffReason = await detectFailFast(
              page,
              { textIncludes: failFastTextIncludes, selector: failFastSelector },
              300
            );
            if (ffReason) {
              log.push(`🛑 失败快判（DOM 优先前）：${ffReason}`);
              throw new FailFastError(ffReason);
            }
            imageBuffer = extracted.buffer;
            contentType = extracted.mimeType;
            extractionMethod = 'dom';
            log.push(`✅ DOM 优先提取成功 (${(imageBuffer.length / 1024).toFixed(1)} KB)，跳过浏览器下载`);
          }
        } else {
          log.push(`⚠️ DOM 优先提取：未找到图片 src，回退到下载流程`);
        }
        }
      } catch (e) {
        log.push(`⚠️ DOM 优先提取失败，回退到下载流程: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // ── waitForNew 模式：先记录当前按钮数，等新按钮出现后再下载 ──────────────────
    if (!imageBuffer && waitForNew) {
      let initialCount = 0;
      try {
        initialCount = await page.locator(selector).count();
      } catch { initialCount = 0; }
      log.push(`⏳ waitForNew 模式：当前下载按钮数 ${initialCount}，等待新按钮出现...`);
      const deadline = Date.now() + waitForNewTimeout;
      let found = false;
      while (Date.now() < deadline) {
        await page.waitForTimeout(1500);

        const reason = await detectFailFast(
          page,
          { textIncludes: failFastTextIncludes, selector: failFastSelector },
          300
        );
        if (reason) {
          log.push(`🛑 失败快判：${reason}`);
          throw new FailFastError(reason);
        }

        try {
          const cur = await page.locator(selector).count();
          if (cur > initialCount) {
            log.push(`✅ 新按钮已出现: ${cur} 个（原 ${initialCount} 个），继续下载`);
            found = true;
            break;
          }
        } catch {
          /* ignore */
        }
      }
      if (!found) {
        log.push(`⚠️ waitForNew 等待超时 ${waitForNewTimeout}ms，继续使用当前按钮`);
      }
    }

    let mode: 'direct' | 'menu' | 'none' = 'none';
    if (!imageBuffer) {
    pushLog(`⏳ 等待/定位下载入口（直连 Download 或「更多」菜单）…`);
    log.push(`🔍 查找下载入口: direct=${selector} | menuTrigger=${menuTriggerSelector}`);
    let count = 0;
    let idx = -1;
    const loc = page.locator(selector);

    const entryDeadline = Date.now() + buttonTimeout;
    while (Date.now() < entryDeadline) {
      const reason = await detectFailFast(
        page,
        { textIncludes: failFastTextIncludes, selector: failFastSelector },
        300
      );
      if (reason) {
        log.push(`🛑 失败快判：${reason}`);
        throw new FailFastError(reason);
      }

      count = await loc.count().catch(() => 0);
      if (count > 0) {
        idx = pickIndex(count, buttonIndex);
        log.push(`✅ 下载按钮数量: ${count}, 选择第 ${idx + 1} 个`);
        mode = 'direct';
        break;
      }

      const triggerCount = await page.locator(menuTriggerSelector).count().catch(() => 0);
      if (triggerCount > 0) {
        mode = 'menu';
        log.push(`✅ 菜单触发按钮数量: ${triggerCount}`);
        break;
      }

      await page.waitForTimeout(500);
    }

    if (mode === 'none') {
      log.push(`⚠️ 未找到下载入口（直连按钮和菜单入口均不存在）`);
    }

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-extract-image-download-'));
    const videoState = await detectVideoResult(page);
    if (videoState.isVideo) {
      log.push(`🎬 检测到当前结果为视频，将按媒体文件继续提取（${videoState.reason || '非图片结果'}）`);
    }

    if (mode !== 'none') {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const runAttempt = async (): Promise<boolean> => {
          // 记录本次点击前的剪贴板图片哈希，避免“吃到旧剪贴板”导致误判成功。
          const beforeClip = allowClipboardFallback ? await readImageFromClipboard(page) : null;
          const beforeClipHash = beforeClip?.buffer?.length ? sha256(beforeClip.buffer) : null;

          try {
            log.push(`⬇️ 开始下载 (尝试 ${attempt}/${maxRetries})`);
            pushLog(`⏳ 触发点击后等待浏览器 Download 事件（超时 ${Math.round(downloadTimeout / 1000)}s）…`);
            const downloadPromise = page.waitForEvent('download', { timeout: downloadTimeout });
            if (mode === 'direct') {
              pushLog(`🖱️ 点击直连下载按钮（第 ${idx + 1} 个）…`);
              await loc.nth(idx).click({ timeout: buttonTimeout });
            } else {
              const triggerLoc = page.locator(menuTriggerSelector);
              const triggerCount = await triggerLoc.count();
              if (triggerCount <= 0) throw new Error('菜单触发按钮不存在');
              const triggerIndex = pickIndex(triggerCount, buttonIndex);
              pushLog(`🖱️ 打开「更多」菜单（第 ${triggerIndex + 1} 个触发器）…`);
              await triggerLoc.nth(triggerIndex).click({ timeout: buttonTimeout });

              const itemLoc = page.locator(menuItemSelector);
              const menuDeadline = Date.now() + 10_000;
              let itemCount = 0;
              while (Date.now() < menuDeadline) {
                const reason = await detectFailFast(
                  page,
                  { textIncludes: failFastTextIncludes, selector: failFastSelector },
                  300
                );
                if (reason) {
                  log.push(`🛑 失败快判：${reason}`);
                  throw new FailFastError(reason);
                }
                itemCount = await itemLoc.count().catch(() => 0);
                if (itemCount > 0) break;
                await page.waitForTimeout(300);
              }
              if (itemCount <= 0) throw new Error('菜单中未找到下载项');

              const itemIndex = pickIndex(itemCount, buttonIndex);
              pushLog(`🖱️ 点击菜单内下载项（第 ${itemIndex + 1} 个）…`);
              await itemLoc.nth(itemIndex).click({ timeout: 10_000 });
            }
            if (waitAfterClick > 0) await page.waitForTimeout(waitAfterClick);
            const download = await downloadPromise;
            pushLog(`📨 已收到 Download 事件，正在写入临时文件…`);
            fileName = download.suggestedFilename() || `image-${Date.now()}.png`;
            finalPath = path.join(tempDir, `${Date.now()}-${attempt}-${fileName}`);
            await download.saveAs(finalPath);
            const stat = await fs.stat(finalPath);
            if (stat.size <= 0) throw new Error('下载文件为空');
            if (minFileSizeBytes > 0 && stat.size < minFileSizeBytes) {
              throw new Error(`下载文件过小(${stat.size} bytes)，低于阈值 ${minFileSizeBytes}`);
            }
            imageBuffer = await fs.readFile(finalPath);
            contentType = inferMimeType(fileName);
            extractionMethod = 'download';
            pushLog(`✅ 图片已下载完整: ${fileName}（${(stat.size / 1024).toFixed(1)} KB）`);
            return true;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (isFailFastError(err)) {
              log.push(`🛑 ${message}`);
              throw err;
            }
            log.push(`⚠️ 下载失败: ${message}`);

            if (copyImageButtonSelector) {
              const viaCopy = await tryExtractViaCopyButton(
                page,
                copyImageButtonSelector,
                beforeClipHash,
                minFileSizeBytes,
                log
              );
              if (viaCopy) {
                const ffReason = await detectFailFast(
                  page,
                  { textIncludes: failFastTextIncludes, selector: failFastSelector },
                  300
                );
                if (ffReason) {
                  log.push(`🛑 失败快判（复制兜底前）：${ffReason}`);
                  throw new FailFastError(ffReason);
                }
                imageBuffer = viaCopy.buffer;
                contentType = viaCopy.mimeType;
                fileName = `download-copy-${Date.now()}.png`;
                extractionMethod = 'clipboard';
                log.push(`✅ 下载失败后复制按钮兜底成功 (${(imageBuffer.length / 1024).toFixed(1)} KB)`);
                return true;
              }
            }

            // 再尝试 DOM（pickBestImageSrc 已优先 generated-image 内大图，减轻误选参考图预览）
            if (allowDomFallback) {
              try {
                const src = await pickBestImageSrc(page, fallbackImageSelector);
                if (src) {
                  const extracted = await readImageBufferFromPage(page, src);
                  if (minFileSizeBytes > 0 && extracted.buffer.length < minFileSizeBytes) {
                    log.push(`⚠️ DOM 兜底图片过小(${extracted.buffer.length} bytes)，低于阈值 ${minFileSizeBytes}`);
                  } else {
                    const ffReason = await detectFailFast(
                      page,
                      { textIncludes: failFastTextIncludes, selector: failFastSelector },
                      300
                    );
                    if (ffReason) {
                      log.push(`🛑 失败快判（DOM 兜底前）：${ffReason}`);
                      throw new FailFastError(ffReason);
                    }
                    imageBuffer = extracted.buffer;
                    contentType = extracted.mimeType;
                    fileName = `download-dom-${Date.now()}.png`;
                    extractionMethod = 'dom';
                    log.push(`✅ DOM 兜底提取成功 (${(imageBuffer.length / 1024).toFixed(1)} KB)`);
                    return true;
                  }
                }
              } catch (e) {
                const em = e instanceof Error ? e.message : String(e);
                log.push(`⚠️ DOM 兜底提取失败: ${em}`);
              }
            }

            if (allowClipboardFallback) {
              const clip = await readImageFromClipboard(page);
              if (clip && clip.buffer.length > 0) {
                const afterHash = sha256(clip.buffer);
                if (beforeClipHash && afterHash === beforeClipHash) {
                  log.push(`⚠️ 剪贴板图片未变化（疑似旧剪贴板），跳过剪贴板兜底`);
                } else if (minFileSizeBytes > 0 && clip.buffer.length < minFileSizeBytes) {
                  log.push(`⚠️ 剪贴板图片过小(${clip.buffer.length} bytes)，低于阈值 ${minFileSizeBytes}`);
                } else {
                  imageBuffer = clip.buffer;
                  contentType = clip.mimeType;
                  fileName = `download-clipboard-${Date.now()}.png`;
                  extractionMethod = 'clipboard';
                  log.push(`✅ 下载兜底：剪贴板图片 (${(imageBuffer.length / 1024).toFixed(1)} KB)`);
                  return true;
                }
              }
            }

            if (attempt === maxRetries) {
              log.push(`⚠️ 下载事件已重试 ${maxRetries} 次，仍未拿到有效媒体`);
            }
            return false;
          }
        };
        try {
          const ok = await withSystemClipboardLock(runAttempt, {
            enabled:
              serializeClipboardAccess &&
              (allowClipboardFallback || Boolean(copyImageButtonSelector)),
          });
          if (ok || imageBuffer) break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.push(`⚠️ 下载失败: ${message}`);
          if (isFailFastError(err)) {
            throw err;
          }
          if (attempt === maxRetries) {
            log.push(`⚠️ 下载事件已重试 ${maxRetries} 次，转 DOM 兜底提取`);
          }
        }
      }
    }
    } // end !imageBuffer (button finding + download)

    if (!imageBuffer) {
      const beforeFallbackVideoState = await detectVideoResult(page);
      if (beforeFallbackVideoState.isVideo) {
        log.push(`🎬 DOM 兜底前确认当前结果为视频（${beforeFallbackVideoState.reason || '非图片结果'}）`);
      }
      if (copyImageButtonSelector) {
        const clip0 = await readImageFromClipboard(page).catch(() => null);
        const h0 = clip0?.buffer?.length ? sha256(clip0.buffer) : null;
        const viaCopyFinal = await tryExtractViaCopyButton(
          page,
          copyImageButtonSelector,
          h0,
          minFileSizeBytes,
          log
        );
        if (viaCopyFinal) {
          const ffReason = await detectFailFast(
            page,
            { textIncludes: failFastTextIncludes, selector: failFastSelector },
            300
          );
          if (ffReason) {
            log.push(`🛑 失败快判（最终复制兜底前）：${ffReason}`);
            throw new FailFastError(ffReason);
          }
          imageBuffer = viaCopyFinal.buffer;
          contentType = viaCopyFinal.mimeType;
          fileName = `fallback-copy-${Date.now()}.png`;
          extractionMethod = 'clipboard';
          log.push(`✅ 最终复制按钮兜底 (${(imageBuffer.length / 1024).toFixed(1)} KB)`);
        }
      }
      if (!imageBuffer) {
        if (!allowDomFallback) {
          log.push(`↩️ 下载链路未拿到媒体，强制启用一次 DOM 兜底提取（即使 allowDomFallback=false）`);
        }
        log.push(`↩️ 下载事件失败，尝试 DOM 兜底提取: ${fallbackImageSelector}`);
        const src = await pickBestImageSrc(page, fallbackImageSelector);
        if (!src) throw new Error(`兜底提取失败：未找到图片 src (${fallbackImageSelector})`);
        const extracted = await readImageBufferFromPage(page, src);
        const ffReasonFinal = await detectFailFast(
          page,
          { textIncludes: failFastTextIncludes, selector: failFastSelector },
          300
        );
        if (ffReasonFinal) {
          log.push(`🛑 失败快判（最终 DOM 兜底前）：${ffReasonFinal}`);
          throw new FailFastError(ffReasonFinal);
        }
        imageBuffer = extracted.buffer;
        contentType = extracted.mimeType;
        fileName = `fallback-${Date.now()}.png`;
        if (minFileSizeBytes > 0 && imageBuffer.length < minFileSizeBytes) {
          throw new Error(`兜底图片过小(${imageBuffer.length} bytes)，低于阈值 ${minFileSizeBytes}`);
        }
        log.push(`✅ DOM 兜底提取成功 (${(imageBuffer.length / 1024).toFixed(1)} KB)`);
      }
    }

    if (!imageBuffer) {
      throw new Error('提取失败：未获得图片 buffer');
    }

    const detectedMedia = sniffMediaType(imageBuffer, fileName || ossPath);
    contentType = detectedMedia.mimeType || contentType;
    if (!isSupportedMediaMimeType(contentType)) {
      throw new Error(`检测到不支持的媒体格式 ${contentType}`);
    }
    if (detectedMedia.extension) {
      fileName = withExtension(fileName || `image-${Date.now()}`, detectedMedia.extension);
      ossPath = withExtension(ossPath, detectedMedia.extension);
      if (finalPath) {
        finalPath = withExtension(finalPath, detectedMedia.extension);
      }
    }

    const mediaKind = contentType.startsWith('video/') ? 'video' : 'image';
    let mediaUrl = finalPath;
    if (useLocalApi) {
      const uploadUrl = String(
        params.localFilesUploadUrl || process.env.WORKFLOW_LOCAL_FILES_UPLOAD_URL || ''
      ).trim();
      if (!uploadUrl) {
        throw new Error(
          'storageBackend=local_api 时需配置节点参数 localFilesUploadUrl 或环境变量 WORKFLOW_LOCAL_FILES_UPLOAD_URL'
        );
      }
      const timeoutMs = params.localFilesUploadTimeoutMs ?? 120_000;
      const safeName = (fileName || `image-${Date.now()}.png`).replace(/[^\w.\-()[\] ]+/g, '_');
      pushLog(
        `📤 本地文件服务上传中（约 ${(imageBuffer.length / 1024).toFixed(1)} KB）→ ${uploadUrl}`
      );
      mediaUrl = await uploadBufferToLocalFilesApi(
        imageBuffer,
        safeName,
        contentType,
        uploadUrl,
        timeoutMs
      );
      pushLog(`✅ 本地存储 URL: ${mediaUrl}`);
    } else if (useOss) {
      pushLog(
        `☁️ OSS 上传中（约 ${(imageBuffer.length / 1024).toFixed(1)} KB）→ bucket 对象键: ${ossPath}`
      );
      mediaUrl = await uploadBuffer(imageBuffer, ossPath, contentType);
      pushLog(`✅ OSS 上传成功，公网 URL: ${mediaUrl}`);
    } else if (!finalPath) {
      finalPath = path.join(tempDir, fileName || `image-${Date.now()}.bin`);
      await fs.writeFile(finalPath, imageBuffer);
      mediaUrl = finalPath;
    }

    ctx.vars[outputVar] = mediaUrl;
    ctx.vars.mediaUrl = mediaUrl;
    ctx.vars.mediaType = contentType;
    if (mediaKind === 'video') {
      ctx.vars.videoUrl = mediaUrl;
    } else {
      ctx.vars.imageUrl = mediaUrl;
    }
    const refHint = String(ctx.vars.sourceImageUrl ?? ctx.vars.sourceImageUrls ?? '').trim();
    pushLog(
      `🧩 本节点产出：${useLocalApi ? '本地 API' : useOss ? 'OSS' : '本地路径'} → ${outputVar}=${mediaUrl}` +
        (refHint ? `；输入参考图仍在任务变量 sourceImageUrl（勿与 generatedImageUrl 混淆）` : '')
    );

    const screenshot = await captureScreenshot(page);
    return {
      success: true,
      log,
      screenshot,
      output: {
        imageUrl: mediaUrl,
        /** 与参考图 sourceImageUrl 区分：固定表示「本次 Gemini 生成结果」的公网地址 */
        generatedImageUrl: mediaUrl,
        mediaUrl,
        primaryMediaUrl: mediaUrl,
        mediaType: contentType,
        mediaKind,
        isVideo: mediaKind === 'video',
        [outputVar]: mediaUrl,
        fileName,
        fileSize: imageBuffer.length,
        mimeType: contentType,
        extractionMethod,
        storageBackend: useLocalApi ? 'local_api' : useOss ? 'oss' : 'none',
      },
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (isFailFastError(e)) {
      const failFastAction = normalizeFailFastAction((params as { failFastAction?: unknown }).failFastAction);
      if (failFastAction === 'skip_node') {
        log.push(`⏭️ fast-fail 命中，按策略跳过当前节点并继续后续步骤`);
        const screenshot = await captureScreenshot(page).catch(() => undefined);
        return {
          success: true,
          log,
          screenshot,
          output: {
            skippedByFailFast: true,
            failFastAction,
            failFastReason: error,
          },
        };
      }
    }
    log.push(`❌ 下载提取失败: ${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    const parsed = parseWorkflowStepErrorMessage(error);
    const ff = e instanceof FailFastError ? e : null;
    return {
      success: false,
      log,
      error,
      errorCode: ff?.errorCode ?? parsed.error_code,
      errorMsg: ff?.errorMsg ?? parsed.error_msg,
      screenshot,
    };
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
