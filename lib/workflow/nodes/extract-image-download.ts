import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Page } from 'playwright';
import type { ExtractImageDownloadParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import { uploadBuffer } from '../../oss';

declare global {
  // 串行化“下载点击 + 剪贴板读取”，避免多实例并发串图
  var __extractImageDownloadClipboardQueue: Promise<void> | undefined;
}

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
  return 'application/octet-stream';
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

async function withClipboardLock<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  if (!enabled) return fn();
  const prev = global.__extractImageDownloadClipboardQueue || Promise.resolve();
  let release!: () => void;
  global.__extractImageDownloadClipboardQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
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
    let ossPath = params.ossPath || 'gemini-images/{{timestamp}}.png';
    ossPath = ossPath.replace(/\{\{timestamp\}\}/g, String(Date.now()));

    log.push(`🔍 查找下载按钮: ${selector}`);
    let count = 0;
    let idx = -1;
    let mode: 'direct' | 'menu' | 'none' = 'none';
    const loc = page.locator(selector);
    try {
      await page.waitForSelector(selector, { timeout: Math.min(buttonTimeout, 8_000) });
      count = await loc.count();
      idx = pickIndex(count, buttonIndex);
      if (count > 0) {
        log.push(`✅ 下载按钮数量: ${count}, 选择第 ${idx + 1} 个`);
        mode = 'direct';
      }
    } catch {
      log.push(`⚠️ 未找到直接下载按钮，尝试菜单下载入口`);
    }

    if (mode === 'none') {
      try {
        await page.waitForSelector(menuTriggerSelector, { timeout: buttonTimeout });
        const triggerCount = await page.locator(menuTriggerSelector).count();
        if (triggerCount > 0) {
          mode = 'menu';
          log.push(`✅ 菜单触发按钮数量: ${triggerCount}`);
        }
      } catch {
        log.push(`⚠️ 未找到菜单触发按钮`);
      }
    }

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-extract-image-download-'));

    let finalPath = '';
    let fileName = '';
    let contentType = 'application/octet-stream';
    let imageBuffer: Buffer | null = null;

    if (mode !== 'none') {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const runAttempt = async (): Promise<boolean> => {
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
              await page.waitForSelector(menuItemSelector, { timeout: 10_000 });
              const itemLoc = page.locator(menuItemSelector);
              const itemCount = await itemLoc.count();
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
            log.push(`✅ 下载成功: ${fileName} (${(stat.size / 1024).toFixed(1)} KB)`);
            return true;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.push(`⚠️ 下载失败: ${message}`);
            if (allowClipboardFallback) {
              const clip = await readImageFromClipboard(page);
              if (clip && clip.buffer.length > 0) {
                if (minFileSizeBytes > 0 && clip.buffer.length < minFileSizeBytes) {
                  log.push(`⚠️ 剪贴板图片过小(${clip.buffer.length} bytes)，低于阈值 ${minFileSizeBytes}`);
                } else {
                  imageBuffer = clip.buffer;
                  contentType = clip.mimeType;
                  fileName = `download-clipboard-${Date.now()}.png`;
                  log.push(`✅ 下载按钮返回剪贴板原图 (${(imageBuffer.length / 1024).toFixed(1)} KB)`);
                  return true;
                }
              }
            }
            if (attempt === maxRetries) {
              log.push(`⚠️ 下载事件已重试 ${maxRetries} 次，转 DOM 兜底提取`);
            }
            return false;
          }
        };
        try {
          const ok = await withClipboardLock(allowClipboardFallback && serializeClipboardAccess, runAttempt);
          if (ok || imageBuffer) break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.push(`⚠️ 下载失败: ${message}`);
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

    let imageUrl = finalPath;
    if (uploadToOSS) {
      log.push(`☁️ 上传 OSS: ${ossPath}`);
      imageUrl = await uploadBuffer(imageBuffer, ossPath, contentType);
      log.push(`✅ 上传成功: ${imageUrl}`);
    } else if (!finalPath) {
      finalPath = path.join(tempDir, fileName || `image-${Date.now()}.bin`);
      await fs.writeFile(finalPath, imageBuffer);
      imageUrl = finalPath;
    }

    ctx.vars[outputVar] = imageUrl;
    const screenshot = await captureScreenshot(page);
    return {
      success: true,
      log,
      screenshot,
      output: {
        imageUrl,
        [outputVar]: imageUrl,
        fileName,
        fileSize: imageBuffer.length,
        mimeType: contentType,
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
