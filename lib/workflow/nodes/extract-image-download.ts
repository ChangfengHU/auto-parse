import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { Locator, Page } from 'playwright';
import type { ExtractImageDownloadParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import { withSystemClipboardLock } from '../clipboard-lock';
import { uploadBuffer } from '../../oss';
import type { ParseR2Config, ParseUploadProvider } from '../../parse/types';
import { normalizeFailFastAction, normalizeFailFastTextIncludes } from './fail-fast-text';
import { parseWorkflowStepErrorMessage } from '../step-error-meta';

const DEFAULT_LOCAL_FILES_UPLOAD_URL = 'http://127.0.0.1:1002/v1beta/files:upload';

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

function isDownloadPreviewUrl(url: string): boolean {
  const value = String(url || '').trim().toLowerCase();
  return (
    value.startsWith('file:') ||
    value.startsWith('blob:') ||
    value.startsWith('chrome://downloads') ||
    value.startsWith('chrome-error://chromewebdata')
  );
}

async function cleanupDownloadPreviewPages(page: Page, log: string[]) {
  const pages = page.context().pages();
  let closed = 0;
  for (const candidate of pages) {
    if (candidate === page || candidate.isClosed()) continue;
    const url = candidate.url();
    if (!isDownloadPreviewUrl(url)) continue;
    await candidate.close({ runBeforeUnload: false }).catch(() => {});
    closed++;
  }

  const currentUrl = page.url();
  if (isDownloadPreviewUrl(currentUrl)) {
    const restored = await page
      .goBack({ waitUntil: 'domcontentloaded', timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    log.push(
      restored
        ? `🧹 已从下载/文件预览页返回工作页: ${currentUrl}`
        : `⚠️ 当前页停留在下载/文件预览页，自动返回失败: ${currentUrl}`
    );
  }

  if (closed > 0) {
    log.push(`🧹 已关闭 ${closed} 个下载/文件预览标签页，保留 Gemini 工作页`);
  }
}

async function closeIfDownloadPreviewPage(candidate: Page, activePage: Page, log: string[]): Promise<boolean> {
  if (candidate === activePage || candidate.isClosed()) return false;

  for (let attempt = 0; attempt < 12; attempt++) {
    if (candidate.isClosed()) return false;
    const url = candidate.url();
    if (isDownloadPreviewUrl(url)) {
      await candidate.close({ runBeforeUnload: false }).catch(() => {});
      log.push(`🧹 已拦截并关闭下载/文件预览标签页: ${url}`);
      return true;
    }
    if (url && url !== 'about:blank') return false;
    await candidate.waitForTimeout(150).catch(() => {});
  }

  return false;
}

async function withDownloadPreviewSuppression<T>(
  page: Page,
  log: string[],
  action: () => Promise<T>
): Promise<T> {
  const context = page.context();
  const pendingClosures: Array<Promise<unknown>> = [];

  const onPage = (candidate: Page) => {
    pendingClosures.push(closeIfDownloadPreviewPage(candidate, page, log));
  };

  const restoreCurrentIfPreview = async () => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !page.isClosed()) {
      const url = page.url();
      if (isDownloadPreviewUrl(url)) {
        const restored = await page
          .goBack({ waitUntil: 'domcontentloaded', timeout: 3_000 })
          .then(() => true)
          .catch(() => false);
        log.push(
          restored
            ? `🧹 已抑制当前页下载/文件预览并返回工作页: ${url}`
            : `⚠️ 当前页进入下载/文件预览，自动返回失败: ${url}`
        );
        return;
      }
      await page.waitForTimeout(150).catch(() => {});
    }
  };

  context.on('page', onPage);
  try {
    const restoreCurrent = restoreCurrentIfPreview();
    const result = await action();
    await page.waitForTimeout(300).catch(() => {});
    await Promise.allSettled([restoreCurrent, ...pendingClosures]);
    return result;
  } finally {
    context.off('page', onPage);
  }
}

async function downloadWithCdp(
  page: Page,
  click: () => Promise<void>,
  downloadDir: string,
  timeoutMs: number
): Promise<{ path: string; fileName: string }> {
  const session = await page.context().newCDPSession(page);
  let guid = '';
  let suggestedFilename = '';
  try {
    await session.send('Browser.setDownloadBehavior', {
      behavior: 'allowAndName',
      downloadPath: downloadDir,
      eventsEnabled: true,
    });
    const completed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP 下载超时 ${timeoutMs}ms`)), timeoutMs);
      session.on('Browser.downloadWillBegin', (event) => {
        guid = String(event.guid || '');
        suggestedFilename = String(event.suggestedFilename || '');
      });
      session.on('Browser.downloadProgress', (event) => {
        if (guid && event.guid !== guid) return;
        if (event.state === 'completed') {
          clearTimeout(timer);
          resolve();
        } else if (event.state === 'canceled') {
          clearTimeout(timer);
          reject(new Error('CDP 下载被浏览器取消'));
        }
      });
    }).then(
      () => ({ ok: true as const }),
      (error) => ({ error })
    );
    await click();
    const completedResult = await completed;
    if ('error' in completedResult) throw completedResult.error;
    if (!guid) throw new Error('CDP 下载完成但未收到 guid');
    return {
      path: path.join(downloadDir, guid),
      fileName: suggestedFilename || `image-${Date.now()}.png`,
    };
  } finally {
    await session.detach().catch(() => {});
  }
}

async function captureDownloadResponse(
  page: Page,
  click: () => Promise<void>,
  timeoutMs: number,
  minimumSize: number
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const responsePromise = page
    .waitForResponse(
      (response) => {
        const mimeType = response.headers()['content-type']?.split(';')[0]?.trim().toLowerCase() || '';
        const contentLength = Number(response.headers()['content-length'] || 0);
        const looksLikeOriginal = response.url().includes('/rd-gg/') || contentLength >= minimumSize;
        return response.ok() && isSupportedMediaMimeType(mimeType) && looksLikeOriginal;
      },
      { timeout: timeoutMs }
    )
    .then(
      (response) => ({ response }),
      (error) => ({ error })
    );
  await click();
  const result = await responsePromise;
  if ('error' in result) throw result.error;
  const response = result.response;
  const mimeType = response.headers()['content-type']?.split(';')[0]?.trim().toLowerCase() || '';
  const extension = sniffMediaType(Buffer.alloc(0), `media.${mimeType.split('/')[1] || 'bin'}`).extension;
  return {
    buffer: await response.body(),
    fileName: `download-response-${Date.now()}${extension}`,
    mimeType,
  };
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
  const blob = new Blob([new Uint8Array(buffer)], { type: contentType });
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

async function detectTextOnlyResponse(page: Page): Promise<{ textOnly: boolean; reason?: string }> {
  try {
    const result = await page.evaluate(() => {
      // 只认顶层 model-response：response-element 嵌套在其内部，混在一起取"最后一个"
      // 可能拿到图片之后的纯文本子块，把有图的回复误判成仅文本。
      const modelResponses = Array.from(document.querySelectorAll('model-response'));
      const responseElements = Array.from(document.querySelectorAll('response-element'));
      const latest = modelResponses.length > 0
        ? modelResponses[modelResponses.length - 1]
        : responseElements.length > 0
          ? responseElements[responseElements.length - 1]
          : null;

      const scope = latest ?? document.body;
      if (!scope) return { textOnly: false };
      const isChatGpt = location.hostname === 'chatgpt.com' || location.hostname.endsWith('.chatgpt.com');

      const hasGeneratedImage =
        scope.querySelector('generated-image img') !== null ||
        (isChatGpt && scope.querySelector('article img') !== null) ||
        (isChatGpt && scope.querySelector('main img') !== null) ||
        (isChatGpt && scope.querySelector('img[alt*="Generated image" i]') !== null) ||
        (isChatGpt && scope.querySelector('img[src*="/backend-api/estuary/content"]') !== null) ||
        scope.querySelector('img[src^="blob:"]') !== null ||
        scope.querySelector('img[src^="data:image"]') !== null;
      const hasVideo = scope.querySelector('video') !== null;
      const hasDownloadOrCopyAction =
        scope.querySelector('a[download]') !== null ||
        scope.querySelector('[aria-label*="Download" i]') !== null ||
        scope.querySelector('[aria-label*="下载"]') !== null ||
        scope.querySelector('[aria-label*="Copy image" i]') !== null ||
        scope.querySelector('[aria-label*="复制图片"]') !== null;

      const hasVisibleLargeImage =
        isChatGpt &&
        Array.from(scope.querySelectorAll('img')).some((img) => {
          const el = img as HTMLImageElement;
          const rect = el.getBoundingClientRect();
          const w = el.naturalWidth || rect.width || 0;
          const h = el.naturalHeight || rect.height || 0;
          return w >= 256 && h >= 256 && rect.width >= 120 && rect.height >= 120;
        });

      if (hasGeneratedImage || hasVisibleLargeImage || hasVideo || hasDownloadOrCopyAction) {
        return { textOnly: false };
      }

      const text = String((scope as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
      if (text.length < 20) {
        return { textOnly: false };
      }
      return {
        textOnly: true,
        reason: `最新响应仅文本，无图片/视频/下载动作（textLen=${text.length}）`,
      };
    });
    return result;
  } catch {
    return { textOnly: false };
  }
}

async function resolveLatestResponseScope(page: Page): Promise<{
  scope: Locator;
  label: string;
} | null> {
  try {
    const responses = page.locator('model-response, response-element');
    const count = await responses.count();
    if (count <= 0) return null;
    return {
      scope: responses.nth(count - 1),
      label: `latest-response#${count}`,
    };
  } catch {
    return null;
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
async function pickBestImageSrc(page: Page, selector: string): Promise<{ src: string; debug: string }> {
  const picked = await page.evaluate((sel) => {
    const imageMeta = (img: HTMLImageElement) => {
      const rect = img.getBoundingClientRect();
      const width = img.naturalWidth || rect.width || 0;
      const height = img.naturalHeight || rect.height || 0;
      const area = Math.max(0, width) * Math.max(0, height);
      const s = img.currentSrc || img.src || '';
      return { img, s, area, rect, width, height };
    };
    const rank = (nodes: HTMLImageElement[]) =>
      nodes
        .map(imageMeta)
        .filter((it) => !!it.s && it.area > 0)
        .sort((a, b) => b.area - a.area);

    const isChatGpt = location.hostname === 'chatgpt.com' || location.hostname.endsWith('.chatgpt.com');
    if (isChatGpt) {
      const allImages = Array.from(document.querySelectorAll(sel)) as HTMLImageElement[];
      const generatedImages = allImages
        .map(imageMeta)
        .filter((it) => {
          const alt = it.img.getAttribute('alt') || '';
          const inComposer =
            Boolean(it.img.closest('form:has(#prompt-textarea), #prompt-textarea, [contenteditable="true"]')) ||
            Boolean(it.img.closest('[data-testid*="composer" i]'));
          return (
            !inComposer &&
            it.s &&
            it.area > 0 &&
            it.rect.width >= 120 &&
            it.rect.height >= 120 &&
            /generated image/i.test(alt)
          );
        })
        .sort((a, b) => b.area - a.area);
      if (generatedImages[0]?.s) {
        const it = generatedImages[0];
        return {
          src: it.s,
          debug: [
            'pickedBy=chatgpt-generated-alt',
            `area=${Math.round(it.area)}`,
            `visible=${Math.round(it.rect.width)}x${Math.round(it.rect.height)}`,
          ].join(', '),
        };
      }

      const articles = Array.from(document.querySelectorAll('article, [data-testid^="conversation-turn-"]'));
      const ranked = allImages
        .map((img) => {
          const meta = imageMeta(img);
          const roleContainer = img.closest('[data-message-author-role]') as HTMLElement | null;
          const article =
            img.closest('article') ||
            roleContainer ||
            img.closest('[data-testid^="conversation-turn-"]');
          const role =
            roleContainer?.getAttribute('data-message-author-role') ||
            (article?.querySelector('[data-message-author-role]') as HTMLElement | null)?.getAttribute('data-message-author-role') ||
            '';
          const articleIndex = article ? articles.indexOf(article) : -1;
          const src = meta.s;
          const alt = img.getAttribute('alt') || '';
          const inComposer =
            Boolean(img.closest('form:has(#prompt-textarea), #prompt-textarea, [contenteditable="true"]')) ||
            Boolean(img.closest('[data-testid*="composer" i]'));
          const hasResponseActions = article
            ? article.querySelector(
                [
                  'button[aria-label*="Copy" i]',
                  'button[aria-label*="复制"]',
                  'button[aria-label*="Good response" i]',
                  'button[aria-label*="Bad response" i]',
                  'button[aria-label*="Download" i]',
                  'button[aria-label*="下载"]',
                ].join(', ')
              ) !== null
            : false;

          let score = meta.area;
          if (role === 'assistant') score += 100_000_000;
          if (role === 'user') score -= 100_000_000;
          if (hasResponseActions) score += 10_000_000;
          if (/generated image/i.test(alt)) score += 5_000_000;
          if (src.includes('/backend-api/estuary/content')) score += 2_000_000;
          if (articleIndex >= 0) score += articleIndex * 10_000;
          if (inComposer) score -= 200_000_000;

          return { ...meta, role, score };
        })
        .filter((it) => {
          if (!it.s || it.area <= 0) return false;
          if (it.rect.width < 80 || it.rect.height < 80) return false;
          return it.score > -50_000_000;
        })
        .sort((a, b) => b.score - a.score);

      const summarize = (it: (typeof ranked)[number], pickedBy: string) => ({
        src: it.s,
        debug: [
          `pickedBy=${pickedBy}`,
          `role=${it.role || 'unknown'}`,
          `area=${Math.round(it.area)}`,
          `score=${Math.round(it.score)}`,
          `visible=${Math.round(it.rect.width)}x${Math.round(it.rect.height)}`,
        ].join(', '),
      });

      const bestAssistant = ranked.find((it) => it.role === 'assistant');
      if (bestAssistant?.s) return summarize(bestAssistant, 'chatgpt-assistant');
      const bestNonUser = ranked.find((it) => it.role !== 'user');
      if (bestNonUser?.s) return summarize(bestNonUser, 'chatgpt-non-user');
      return { src: '', debug: `pickedBy=chatgpt-none, candidates=${ranked.length}` };
    }

    const genImgs = Array.from(
      document.querySelectorAll(
        'model-response generated-image img, response-element generated-image img, generated-image img'
      )
    ) as HTMLImageElement[];
    const bestGen = rank(genImgs);
    if (bestGen[0]?.s) return { src: bestGen[0].s, debug: 'pickedBy=generated-image' };

    try {
      const nodes = Array.from(document.querySelectorAll(sel)) as HTMLImageElement[];
      const best = rank(nodes);
      return { src: best[0]?.s || '', debug: best[0]?.s ? 'pickedBy=selector-area' : 'pickedBy=none' };
    } catch {
      return { src: '', debug: 'pickedBy=selector-error' };
    }
  }, selector);
  return {
    src: picked?.src || '',
    debug: picked?.debug || 'pickedBy=unknown',
  };
}

function isTrustedGeneratedImagePick(debug: string): boolean {
  const value = String(debug || '').toLowerCase();
  return (
    value.includes('pickedby=generated-image') ||
    value.includes('pickedby=chatgpt-generated-alt') ||
    value.includes('pickedby=chatgpt-assistant') ||
    value.includes('pickedby=chatgpt-non-user')
  );
}

function hasReferenceImageInput(ctx: WorkflowContext): boolean {
  const referenceHint = String(ctx.vars?.sourceImageUrl ?? ctx.vars?.sourceImageUrls ?? '').trim();
  return Boolean(referenceHint);
}

function shouldRejectUnscopedDomFallback(ctx: WorkflowContext, debug: string): boolean {
  return hasReferenceImageInput(ctx) && !isTrustedGeneratedImagePick(debug);
}

async function clearChatGptDragOverlay(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    const dt = new DataTransfer();
    const makeEvt = (type: string) => {
      try {
        return new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
      } catch {
        const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & {
          dataTransfer?: DataTransfer;
        };
        Object.defineProperty(ev, 'dataTransfer', { value: dt });
        return ev;
      }
    };

    for (const type of ['dragleave', 'dragend', 'drop']) {
      window.dispatchEvent(makeEvt(type));
      document.dispatchEvent(makeEvt(type));
      document.body?.dispatchEvent(makeEvt(type));
    }

    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text.includes('Add anything') || !text.includes('Drop any file here')) continue;
      const style = getComputedStyle(el);
      if (style.position !== 'fixed') continue;
      (el as HTMLElement).style.display = 'none';
      (el as HTMLElement).style.pointerEvents = 'none';
      el.setAttribute('data-auto-parse-hidden-drag-overlay', '1');
    }
  }).catch(() => {});
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
    // 只扫最新一条模型回复：扫整页会把用户自己的提示词、历史会话、侧栏 UI 文案都算进去，
    // 配合宽泛词表（如 "but"）极易误杀。无 model-response（如 ChatGPT 页面）时退回 body。
    let bodyText = await page.evaluate(() => {
      const responses = document.querySelectorAll('model-response');
      const scope = responses.length > 0 ? responses[responses.length - 1] : document.body;
      return (scope as HTMLElement)?.innerText || '';
    }).catch(() => '');
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
    const strictDownloadOnly =
      (params as { strictDownloadOnly?: unknown }).strictDownloadOnly !== undefined
        ? Boolean((params as { strictDownloadOnly?: unknown }).strictDownloadOnly)
        : hasReferenceImageInput(ctx);
    const serializeClipboardAccess = params.serializeClipboardAccess ?? true;
    const menuTriggerSelector = (params.menuTriggerSelector || 'button[aria-label*="More options"], button[aria-label*="更多"]').trim();
    const menuItemSelector = (params.menuItemSelector || '[role="menuitem"]:has-text("Download"), [role="menuitem"]:has-text("下载"), button:has-text("Download"), button:has-text("下载")').trim();
    const fallbackImageSelector = (params.fallbackImageSelector || 'img[src^="blob:"], img[src^="data:image"], img').trim();
    const copyImageButtonSelector = String(params.copyImageButtonSelector ?? '').trim();
    const uploadToOSS = params.uploadToOSS ?? true;
    const uploadProvider = params.uploadProvider || (ctx.vars?.uploadProvider as ParseUploadProvider | undefined);
    const useLocalApi = params.storageBackend === 'local_api';
    const useR2 = !useLocalApi && uploadProvider === 'r2';
    const useOss = !useLocalApi && !useR2 && uploadToOSS;
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
      // 优先用文字匹配，其次用选择器，两者都没有则跳过。
      // 选择器优先限定在最新 model-response 内：全页匹配会命中页面上残留的旧图，
      // 导致"图片已就绪"瞬间误判通过。无 model-response 的页面（如 ChatGPT）退回全页。
      const getLocator = async () => {
        if (customText) return page.getByText(customText, { exact: false }).first();
        if (!customSel) return null;
        const responses = page.locator('model-response');
        const n = await responses.count().catch(() => 0);
        if (n > 0) return responses.nth(n - 1).locator(customSel).first();
        return page.locator(customSel).first();
      };
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
          const loc = await getLocator();
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
          const loc = await getLocator();
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
          const loc = await getLocator();
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
          const loc = await getLocator();
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

    // 生成完成后等待 UI 渲染下载按钮（生成图出现和按钮出现之间有短暂延迟）
    const waitAfterImageReady = Math.max(
      0,
      (params as { waitAfterImageReady?: number }).waitAfterImageReady ?? 0
    );
    if (params.waitImageReady && waitAfterImageReady > 0) {
      log.push(`⏳ waitAfterImageReady: 等待 ${waitAfterImageReady}ms 让下载按钮完成渲染…`);
      await page.waitForTimeout(waitAfterImageReady);
    }

    pushLog(
      `📥 生图阶段结束 → 后续：${params.preferDomExtraction ? 'DOM 优先提取 → ' : ''}查找下载入口 / 浏览器下载事件 → 本地校验 → ${useLocalApi ? '本地 API' : useR2 ? 'R2' : useOss ? 'OSS' : '本地文件'}`
    );
    await clearChatGptDragOverlay(page);

    // Gemini 有时从 /images 以新 Tab 方式打开 /app/<id> 结果页（而非在同 Tab 内导航）。
    // 当前 page 仍停在 /images（无 model-response），需切换到有内容的结果 Tab。
    let dp = page; // dp = effective download page
    {
      const hasResp = await page.locator('model-response, response-element').count().catch(() => 0);
      if (hasResp === 0) {
        const candidates = page.context().pages()
          .filter(p => p !== page && !p.isClosed() && /gemini\.google\.com\/app\//.test(p.url()))
          .reverse(); // 最近打开的优先
        for (const candidate of candidates) {
          const c = await candidate.locator('model-response, response-element').count().catch(() => 0);
          if (c > 0) {
            log.push(`🔄 检测到 Gemini 在新 Tab 打开结果页 (${candidate.url()})，切换到该页进行下载`);
            dp = candidate;
            break;
          }
        }
        if (dp === page) log.push('⚠️ 当前页无 model-response，且未在其他 Tab 找到结果页，继续在当前页尝试');
      }
    }

    // 业务硬约束：该节点用于产出视觉媒体；若页面仅文本回复且无可提取视觉元素，立即失败，避免无效重试。
    {
      const textOnly = await detectTextOnlyResponse(dp);
      if (textOnly.textOnly) {
        const reason = textOnly.reason || '检测到仅文本回复';
        pushLog(`🛑 视觉结果校验失败：${reason}`);
        throw new FailFastError(reason);
      }
    }

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
        if (copyImageButtonSelector && !strictDownloadOnly) {
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
        const pickedImage = await pickBestImageSrc(page, domFallbackSel);
        if (pickedImage.src) {
          log.push(`🖼️ 找到图片 src: ${pickedImage.src.slice(0, 100)} (${pickedImage.debug})`);
          if (shouldRejectUnscopedDomFallback(ctx, pickedImage.debug)) {
            log.push(`⚠️ DOM 优先候选不是可信生成图，跳过以避免误传参考图: ${pickedImage.debug}`);
          } else {
          const extracted = await readImageBufferFromPage(page, pickedImage.src);
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
          }
        } else {
          log.push(`⚠️ DOM 优先提取：未找到图片 src，回退到下载流程`);
        }
        }
      } catch (e) {
        log.push(`⚠️ DOM 优先提取失败，回退到下载流程: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const latestScopeMeta = await resolveLatestResponseScope(dp);
    const inScope = <T extends Locator>(globalLoc: T, scopedLocFactory: () => T): T =>
      latestScopeMeta ? scopedLocFactory() : globalLoc;
    if (latestScopeMeta) {
      log.push(`🎯 下载动作定位范围：${latestScopeMeta.label}`);
    } else {
      log.push('⚠️ 未定位到 response 容器，回退为全页按钮定位');
    }

    // ── waitForNew 模式：先记录当前按钮数，等新按钮出现后再下载 ──────────────────
    if (!imageBuffer && waitForNew) {
      let initialCount = 0;
      const scopedDownloadLoc = inScope(
        page.locator(selector),
        () => latestScopeMeta!.scope.locator(selector)
      );
      try {
        initialCount = await scopedDownloadLoc.count();
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
          const cur = await scopedDownloadLoc.count();
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
    const loc = inScope(
      page.locator(selector),
      () => latestScopeMeta!.scope.locator(selector)
    );
    const triggerLocBase = inScope(
      page.locator(menuTriggerSelector),
      () => latestScopeMeta!.scope.locator(menuTriggerSelector)
    );
    const itemLocBase = inScope(
      page.locator(menuItemSelector),
      () => latestScopeMeta!.scope.locator(menuItemSelector)
    );

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

      const triggerCount = await triggerLocBase.count().catch(() => 0);
      if (triggerCount > 0) {
        mode = 'menu';
        log.push(`✅ 菜单触发按钮数量: ${triggerCount}`);
        break;
      }

      await page.waitForTimeout(500);
    }

    if (mode === 'none') {
      log.push(`⚠️ 未找到下载入口（直连按钮和菜单入口均不存在）`);
      if (strictDownloadOnly) {
        throw new Error('严格原图下载模式：未找到下载入口，触发重试');
      }
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
            const clickDownload = async () => {
              if (mode === 'direct') {
                pushLog(`🖱️ 点击直连下载按钮（第 ${idx + 1} 个）…`);
                await loc.nth(idx).click({ timeout: buttonTimeout });
              } else {
                const triggerLoc = triggerLocBase;
                const triggerCount = await triggerLoc.count();
                if (triggerCount <= 0) throw new Error('菜单触发按钮不存在');
                const triggerIndex = pickIndex(triggerCount, buttonIndex);
                pushLog(`🖱️ 打开「更多」菜单（第 ${triggerIndex + 1} 个触发器）…`);
                await triggerLoc.nth(triggerIndex).click({ timeout: buttonTimeout });
                const itemLoc = itemLocBase;
                const menuDeadline = Date.now() + 10_000;
                let itemCount = 0;
                while (Date.now() < menuDeadline) {
                  const reason = await detectFailFast(page, { textIncludes: failFastTextIncludes, selector: failFastSelector }, 300);
                  if (reason) { log.push(`🛑 失败快判：${reason}`); throw new FailFastError(reason); }
                  itemCount = await itemLoc.count().catch(() => 0);
                  if (itemCount > 0) break;
                  await page.waitForTimeout(300);
                }
                if (itemCount <= 0) throw new Error('菜单中未找到下载项');
                const itemIndex = pickIndex(itemCount, buttonIndex);
                pushLog(`🖱️ 点击菜单内下载项（第 ${itemIndex + 1} 个）…`);
                await itemLoc.nth(itemIndex).click({ timeout: 10_000 });
              }
              if (waitAfterClick > 0) await dp.waitForTimeout(waitAfterClick);
            };
            const clickDownloadWithPreviewSuppression = () =>
              withDownloadPreviewSuppression(dp, log, clickDownload);
            try {
              pushLog(`⏳ 捕获下载按钮触发的原图网络响应（超时 ${Math.round(downloadTimeout / 1000)}s）…`);
              const captured = await captureDownloadResponse(
                dp,
                clickDownloadWithPreviewSuppression,
                downloadTimeout,
                minFileSizeBytes
              );
              if (captured.buffer.length <= 0) throw new Error('原图网络响应为空');
              if (minFileSizeBytes > 0 && captured.buffer.length < minFileSizeBytes) {
                throw new Error(`原图网络响应过小(${captured.buffer.length} bytes)，低于阈值 ${minFileSizeBytes}`);
              }
              imageBuffer = captured.buffer;
              fileName = captured.fileName;
              contentType = captured.mimeType;
              extractionMethod = 'download';
              await cleanupDownloadPreviewPages(dp, log);
              pushLog(`✅ 已捕获原图网络响应: ${fileName}（${(imageBuffer.length / 1024).toFixed(1)} KB）`);
              return true;
            } catch (networkErr) {
              log.push(`⚠️ 原图网络响应捕获失败，回退 CDP 下载: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`);
            }

            pushLog(`⏳ 使用 CDP 原生下载通道（超时 ${Math.round(downloadTimeout / 1000)}s）…`);
            const cdpDownload = await downloadWithCdp(
              dp,
              clickDownloadWithPreviewSuppression,
              tempDir,
              downloadTimeout
            );
            fileName = cdpDownload.fileName;
            finalPath = cdpDownload.path;
            const stat = await fs.stat(finalPath);
            if (stat.size <= 0) throw new Error('下载文件为空');
            if (minFileSizeBytes > 0 && stat.size < minFileSizeBytes) {
              throw new Error(`下载文件过小(${stat.size} bytes)，低于阈值 ${minFileSizeBytes}`);
            }
            imageBuffer = await fs.readFile(finalPath);
            contentType = inferMimeType(fileName);
            extractionMethod = 'download';
            await cleanupDownloadPreviewPages(dp, log);
            pushLog(`✅ 图片已下载完整: ${fileName}（${(stat.size / 1024).toFixed(1)} KB）`);
            return true;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (isFailFastError(err)) {
              log.push(`🛑 ${message}`);
              throw err;
            }
            log.push(`⚠️ 下载失败: ${message}`);

            if (strictDownloadOnly) {
              log.push('⚠️ 严格原图下载模式：跳过复制/DOM/剪贴板兜底，等待重试');
            } else if (copyImageButtonSelector) {
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
            if (!strictDownloadOnly && allowDomFallback) {
              try {
                const pickedImage = await pickBestImageSrc(dp, fallbackImageSelector);
                if (pickedImage.src) {
                  log.push(`🖼️ DOM 兜底候选: ${pickedImage.src.slice(0, 100)} (${pickedImage.debug})`);
                  if (shouldRejectUnscopedDomFallback(ctx, pickedImage.debug)) {
                    log.push(`⚠️ DOM 兜底候选不是可信生成图，跳过以避免误传参考图: ${pickedImage.debug}`);
                    return false;
                  }
                  const extracted = await readImageBufferFromPage(dp, pickedImage.src);
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

            if (!strictDownloadOnly && allowClipboardFallback) {
              const clip = await readImageFromClipboard(dp);
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
      if (strictDownloadOnly) {
        throw new Error('严格原图下载模式：下载链路未拿到原图媒体，触发重试');
      }
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
          throw new Error('下载链路未拿到媒体，且 allowDomFallback=false，已禁止使用页面预览图兜底');
        }
        log.push(`↩️ 下载事件失败，尝试 DOM 兜底提取: ${fallbackImageSelector}`);
        const pickedImage = await pickBestImageSrc(dp, fallbackImageSelector);
        if (!pickedImage.src) throw new Error(`兜底提取失败：未找到图片 src (${fallbackImageSelector})；${pickedImage.debug}`);
        log.push(`🖼️ 最终 DOM 兜底候选: ${pickedImage.src.slice(0, 100)} (${pickedImage.debug})`);
        if (shouldRejectUnscopedDomFallback(ctx, pickedImage.debug)) {
          throw new Error(`兜底候选不是可信生成图，拒绝上传以避免误传参考图: ${pickedImage.debug}`);
        }
        const extracted = await readImageBufferFromPage(dp, pickedImage.src);
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
        params.localFilesUploadUrl || process.env.WORKFLOW_LOCAL_FILES_UPLOAD_URL || DEFAULT_LOCAL_FILES_UPLOAD_URL
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
    } else if (useR2) {
      pushLog(`☁️ R2 上传中（约 ${(imageBuffer.length / 1024).toFixed(1)} KB）→ bucket 对象键: ${ossPath}`);
      mediaUrl = await uploadBuffer(imageBuffer, ossPath, contentType, {
        provider: 'r2',
        r2: params.r2Config || (ctx.vars?.r2Config as Partial<ParseR2Config> | undefined),
      });
      pushLog(`✅ R2 上传成功，公网 URL: ${mediaUrl}`);
    } else if (useOss) {
      pushLog(`☁️ OSS 上传中（约 ${(imageBuffer.length / 1024).toFixed(1)} KB）→ bucket 对象键: ${ossPath}`);
      mediaUrl = await uploadBuffer(imageBuffer, ossPath, contentType, { provider: uploadProvider });
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
      `🧩 本节点产出：${useLocalApi ? '本地 API' : useR2 ? 'R2' : useOss ? 'OSS' : '本地路径'} → ${outputVar}=${mediaUrl}` +
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
        storageBackend: useLocalApi ? 'local_api' : useR2 ? 'r2' : useOss ? 'oss' : 'none',
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
