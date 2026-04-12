import type { Page } from 'playwright';
import type { GeminiParallelGenerateParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import { withSystemClipboardLock } from '../clipboard-lock';
import { uploadBuffer } from '../../oss';

interface BranchResult {
  index: number;
  prompt: string;
  success: boolean;
  imageUrl?: string;
  sourceUrl?: string;
  pageUrl?: string;
  extractionMethod?: 'source' | 'clipboard' | 'element_screenshot' | 'page_screenshot';
  error?: string;
}

function normalizePrompts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function mimeToExtension(mimeType: string): string {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('svg')) return 'svg';
  return 'jpg';
}

function renderOssPath(template: string, index: number, mimeType: string): string {
  const timestamp = String(Date.now());
  let key = template.replace(/\{\{timestamp\}\}/g, timestamp).replace(/\{\{index\}\}/g, String(index + 1));
  if (!/\.[a-z0-9]+$/i.test(key)) {
    key += `.${mimeToExtension(mimeType)}`;
  }
  return key;
}

async function readImageBufferFromPage(page: Page, src: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const payload = await page.evaluate(async (imageSrc) => {
    try {
      const res = await fetch(imageSrc);
      if (!res.ok) {
        return { error: `fetch image failed: ${res.status}` };
      }
      const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
      const buf = await res.arrayBuffer();
      return { mimeType, data: Array.from(new Uint8Array(buf)) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, src);

  if ('error' in payload) {
    throw new Error(payload.error);
  }
  return { buffer: Buffer.from(payload.data), mimeType: payload.mimeType || 'image/png' };
}

async function readImageBufferFromClipboard(page: Page): Promise<{ buffer: Buffer; mimeType: string }> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const payload = await page.evaluate(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.includes('image/png')
          ? 'image/png'
          : item.types.find(t => t.startsWith('image/'));
        if (!imgType) continue;
        const blob = await item.getType(imgType);
        const buf = await blob.arrayBuffer();
        return { mimeType: imgType, data: Array.from(new Uint8Array(buf)) };
      }
      for (const item of items) {
        if (!item.types.includes('text/html')) continue;
        const htmlBlob = await item.getType('text/html');
        const html = await htmlBlob.text();
        const match = html.match(/src="((?:blob|data|https?)[^"]+)"/i);
        if (!match) continue;
        const res = await fetch(match[1]);
        if (!res.ok) continue;
        const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
        const buf = await res.arrayBuffer();
        return { mimeType, data: Array.from(new Uint8Array(buf)) };
      }
      return { error: 'clipboard has no image payload' };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  if ('error' in payload) throw new Error(payload.error);
  return { buffer: Buffer.from(payload.data), mimeType: payload.mimeType || 'image/png' };
}

export async function executeGeminiParallelGenerate(
  page: Page,
  params: GeminiParallelGenerateParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  const prompts = normalizePrompts(params.prompts);
  if (prompts.length === 0) {
    return { success: false, log: ['❌ prompts 为空，至少传入 1 条提示词'], error: 'prompts is empty' };
  }

  const maxConcurrency = Math.max(1, Math.min(6, params.maxConcurrency ?? 3));
  const minSuccess = Math.max(1, Math.min(prompts.length, params.minSuccess ?? prompts.length));
  const closeExtraTabs = params.closeExtraTabs ?? true;
  const resolved = {
    url: params.url?.trim() || 'https://gemini.google.com/app',
    inputSelector: params.inputSelector?.trim() || 'textarea',
    preClickText: params.preClickText?.trim(),
    preClickSelector: params.preClickSelector?.trim(),
    submitSelector: params.submitSelector?.trim(),
    successSelector: params.successSelector?.trim() || '[aria-label="Copy image"]',
    imageSelector: params.imageSelector?.trim(),
    uploadToOSS: params.uploadToOSS ?? true,
    ossPath: params.ossPath?.trim() || 'gemini-images/{{timestamp}}-{{index}}.png',
    perTabTimeout: Math.max(10_000, params.perTabTimeout ?? 180_000),
  };
  const outputVar = params.outputVar?.trim() || 'geminiImageUrls';
  const outputDetailVar = params.outputDetailVar?.trim() || 'geminiBranches';

  ctx.emit?.('log', `🚀 并发生图开始：${prompts.length} 条提示词，并发=${maxConcurrency}`);
  log.push(`🚀 并发生图开始：${prompts.length} 条提示词，并发=${maxConcurrency}`);

  const branchPages: Page[] = [];
  const worker = async (index: number, prompt: string): Promise<BranchResult> => {
    const branchPage = await page.context().newPage();
    branchPages.push(branchPage);
    const prefix = `🧵 [并发分支 ${index + 1}]`;
    try {
      ctx.emit?.('log', `${prefix} 启动`);
      await branchPage.goto(resolved.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      if (resolved.preClickSelector) {
        await branchPage.locator(resolved.preClickSelector).first().click({ timeout: 10_000 });
      } else if (resolved.preClickText) {
        await branchPage.getByRole('button', { name: resolved.preClickText }).last().click({ timeout: 10_000 });
      }
      await branchPage.waitForSelector(resolved.inputSelector, { state: 'visible', timeout: 20_000 });
      const input = branchPage.locator(resolved.inputSelector).first();
      await input.fill(prompt);
      if (resolved.submitSelector) {
        await branchPage.locator(resolved.submitSelector).first().click({ timeout: 10_000 });
      } else {
        await input.press('Enter');
      }
      await branchPage.waitForSelector(resolved.successSelector, { state: 'visible', timeout: resolved.perTabTimeout });
      const sourceUrl = resolved.imageSelector
        ? await branchPage.locator(resolved.imageSelector).first().getAttribute('src').then(v => v ?? '').catch(() => '')
        : '';
      let imageUrl = sourceUrl;
      let extractionMethod: BranchResult['extractionMethod'] = 'source';
      if (resolved.uploadToOSS) {
        let buffer: Buffer | null = null;
        let mimeType = 'image/png';

        if (sourceUrl) {
          try {
            const imageData = await readImageBufferFromPage(branchPage, sourceUrl);
            buffer = imageData.buffer;
            mimeType = imageData.mimeType;
            extractionMethod = 'source';
            ctx.emit?.('log', `${prefix} 使用 source URL 提取图片`);
          } catch {
            ctx.emit?.('log', `${prefix} source URL 提取失败，准备回退剪贴板原图`);
          }
        }

        if (!buffer) {
          try {
            const copySelector = resolved.successSelector;
            await withSystemClipboardLock(async () => {
              const copyBtn = branchPage.locator(copySelector).first();
              await copyBtn.waitFor({ state: 'visible', timeout: 10_000 });
              await copyBtn.click({ timeout: 10_000 });
              await branchPage.waitForTimeout(1200);
              const clip = await readImageBufferFromClipboard(branchPage);
              buffer = clip.buffer;
              mimeType = clip.mimeType;
              extractionMethod = 'clipboard';
            });
            ctx.emit?.('log', `${prefix} 使用剪贴板原图提取图片`);
          } catch {
            ctx.emit?.('log', `${prefix} 剪贴板原图提取失败，回退截图`);
          }
        }

        if (!buffer && resolved.imageSelector) {
          try {
            await branchPage.locator(resolved.imageSelector).first().waitFor({ state: 'visible', timeout: 10_000 });
            buffer = await branchPage.locator(resolved.imageSelector).first().screenshot({ type: 'png' });
            mimeType = 'image/png';
            extractionMethod = 'element_screenshot';
            ctx.emit?.('log', `${prefix} 使用元素截图提取图片`);
          } catch {
            // ignore and fallback to full page
          }
        }

        if (!buffer) {
          buffer = await branchPage.screenshot({ type: 'png' });
          mimeType = 'image/png';
          extractionMethod = 'page_screenshot';
          ctx.emit?.('log', `${prefix} 使用整页截图兜底提取图片`);
        }

        const ossKey = renderOssPath(resolved.ossPath, index, mimeType);
        imageUrl = await uploadBuffer(buffer, ossKey, mimeType);
      }
      const pageUrl = branchPage.url();
      ctx.emit?.('log', `${prefix} 完成`);
      return { index, prompt, success: true, imageUrl, sourceUrl, pageUrl, extractionMethod };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.emit?.('log', `${prefix} 失败：${message}`);
      return { index, prompt, success: false, error: message, pageUrl: branchPage.url() };
    }
  };

  const results: BranchResult[] = [];
  let cursor = 0;
  const slots = Array.from({ length: Math.min(maxConcurrency, prompts.length) }, async () => {
    while (cursor < prompts.length) {
      const next = cursor++;
      const result = await worker(next, prompts[next]);
      results.push(result);
    }
  });
  await Promise.all(slots);

  if (closeExtraTabs) {
    await Promise.all(branchPages.map(p => p.close().catch(() => {})));
  }

  const sorted = results.sort((a, b) => a.index - b.index);
  const successItems = sorted.filter(item => item.success);
  const successCount = successItems.length;
  const imageUrls = successItems
    .map(item => item.imageUrl?.trim() || '')
    .filter(Boolean);
  const success = successCount >= minSuccess;

  ctx.vars[outputVar] = JSON.stringify(imageUrls);
  ctx.vars[outputDetailVar] = JSON.stringify(sorted);
  successItems.forEach(item => {
    const branchUrl = item.imageUrl?.trim() || '(空)';
    const line = `🔗 分支 ${item.index + 1} URL: ${branchUrl}`;
    log.push(line);
    ctx.emit?.('log', line);
  });
  const aggregateLine = `🧩 输出变量 ${outputVar} = ${JSON.stringify(imageUrls)}`;
  log.push(aggregateLine);
  ctx.emit?.('log', aggregateLine);
  log.push(`✅ 并发完成：成功 ${successCount}/${prompts.length}，阈值=${minSuccess}`);
  ctx.emit?.('log', `✅ 并发完成：成功 ${successCount}/${prompts.length}，阈值=${minSuccess}`);

  const screenshot = await captureScreenshot(page).catch(() => undefined);
  return {
    success,
    log,
    screenshot,
    error: success ? undefined : `并发分支成功数不足：${successCount}/${prompts.length}（需要 ${minSuccess}）`,
    output: {
      successCount,
      totalCount: prompts.length,
      imageUrls,
      branches: sorted,
      [outputVar]: imageUrls,
      [outputDetailVar]: sorted,
    },
  };
}
