import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { Page } from 'playwright';
import type { ExtractImageDownloadParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import { withSystemClipboardLock } from '../clipboard-lock';
import { uploadBuffer } from '../../oss';

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

class FailFastError extends Error {
  code = 'FAIL_FAST';
  constructor(reason: string) {
    super(`FAIL_FAST: ${reason}`);
    this.name = 'FailFastError';
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
    try {
      const res = await fetch(imageSrc);
      if (!res.ok) return { error: `fetch image failed: ${res.status}` };
      const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
      const buf = await res.arrayBuffer();
      return { mimeType, data: Array.from(new Uint8Array(buf)) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, src);
  if ('error' in payload) throw new Error(payload.error);
  return { buffer: Buffer.from(payload.data), mimeType: payload.mimeType || 'image/png' };
}

async function pickBestImageSrc(page: Page, selector: string): Promise<string> {
  const src = await page.evaluate((sel) => {
    const nodes = Array.from(document.querySelectorAll(sel)) as HTMLImageElement[];
    const ranked = nodes
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
    return ranked[0]?.s || '';
  }, selector);
  return src || '';
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
    const uploadToOSS = params.uploadToOSS ?? true;
    const outputVar = params.outputVar || 'imageUrl';
    const buttonIndex = params.buttonIndex ?? -1;
    const waitForNew = params.waitForNew ?? false;
    const waitForNewTimeout = params.waitForNewTimeout ?? 120_000;

    const failFastTextIncludes = (params.failFastTextIncludes || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    const failFastSelector = String(params.failFastSelector || '').trim();
    if (failFastTextIncludes.length > 0 || failFastSelector) {
      log.push(
        `🛑 失败快判已启用: ` +
          [
            failFastSelector ? `selector=${failFastSelector}` : '',
            failFastTextIncludes.length > 0 ? `textIncludes=${failFastTextIncludes.length}` : '',
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

    // ── waitForNew 模式：先记录当前按钮数，等新按钮出现后再下载 ──────────────────
    if (waitForNew) {
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

    log.push(`🔍 查找下载入口: direct=${selector} | menuTrigger=${menuTriggerSelector}`);
    let count = 0;
    let idx = -1;
    let mode: 'direct' | 'menu' | 'none' = 'none';
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

    let finalPath = '';
    let fileName = '';
    let contentType = 'application/octet-stream';
    let imageBuffer: Buffer | null = null;
    let extractionMethod: 'download' | 'dom' | 'clipboard' = 'download';
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
            const downloadPromise = page.waitForEvent('download', { timeout: downloadTimeout });
            if (mode === 'direct') {
              await loc.nth(idx).click({ timeout: buttonTimeout });
            } else {
              const triggerLoc = page.locator(menuTriggerSelector);
              const triggerCount = await triggerLoc.count();
              if (triggerCount <= 0) throw new Error('菜单触发按钮不存在');
              const triggerIndex = pickIndex(triggerCount, buttonIndex);
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
              await itemLoc.nth(itemIndex).click({ timeout: 10_000 });
            }
            if (waitAfterClick > 0) await page.waitForTimeout(waitAfterClick);
            const download = await downloadPromise;
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
            log.push(`✅ 下载成功: ${fileName} (${(stat.size / 1024).toFixed(1)} KB)`);
            return true;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (isFailFastError(err)) {
              log.push(`🛑 ${message}`);
              throw err;
            }
            log.push(`⚠️ 下载失败: ${message}`);

            // 兜底优先级调整：先尝试 DOM 兜底（更可能拿到 img/src 原图），最后才尝试剪贴板兜底。
            if (allowDomFallback) {
              try {
                const src = await pickBestImageSrc(page, fallbackImageSelector);
                if (src) {
                  const extracted = await readImageBufferFromPage(page, src);
                  if (minFileSizeBytes > 0 && extracted.buffer.length < minFileSizeBytes) {
                    log.push(`⚠️ DOM 兜底图片过小(${extracted.buffer.length} bytes)，低于阈值 ${minFileSizeBytes}`);
                  } else {
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
            enabled: allowClipboardFallback && serializeClipboardAccess,
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

    if (!imageBuffer && mode === 'none') {
      throw new Error('未找到下载入口（直连按钮和菜单下载均不存在）');
    }

    if (!imageBuffer && !allowDomFallback) {
      throw new Error(`下载失败，已重试 ${maxRetries} 次（已禁用 DOM 兜底）`);
    }

    if (!imageBuffer) {
      const beforeFallbackVideoState = await detectVideoResult(page);
      if (beforeFallbackVideoState.isVideo) {
        log.push(`🎬 DOM 兜底前确认当前结果为视频（${beforeFallbackVideoState.reason || '非图片结果'}）`);
      }
      log.push(`↩️ 下载事件失败，尝试 DOM 兜底提取: ${fallbackImageSelector}`);
      const src = await pickBestImageSrc(page, fallbackImageSelector);
      if (!src) throw new Error(`兜底提取失败：未找到图片 src (${fallbackImageSelector})`);
      const extracted = await readImageBufferFromPage(page, src);
      imageBuffer = extracted.buffer;
      contentType = extracted.mimeType;
      fileName = `fallback-${Date.now()}.png`;
      if (minFileSizeBytes > 0 && imageBuffer.length < minFileSizeBytes) {
        throw new Error(`兜底图片过小(${imageBuffer.length} bytes)，低于阈值 ${minFileSizeBytes}`);
      }
      log.push(`✅ DOM 兜底提取成功 (${(imageBuffer.length / 1024).toFixed(1)} KB)`);
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
    if (uploadToOSS) {
      log.push(`☁️ 上传 OSS: ${ossPath}`);
      mediaUrl = await uploadBuffer(imageBuffer, ossPath, contentType);
      log.push(`✅ 上传成功: ${mediaUrl}`);
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
    const screenshot = await captureScreenshot(page);
    return {
      success: true,
      log,
      screenshot,
      output: {
        imageUrl: mediaUrl,
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
      },
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.push(`❌ 下载提取失败: ${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
