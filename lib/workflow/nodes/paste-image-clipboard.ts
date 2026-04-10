import type { Page } from 'playwright';
import type { NodeResult, PasteImageClipboardParams, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';

declare global {
  var __extractImageClipboardQueue: Promise<void> | undefined;
}

async function withClipboardLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = global.__extractImageClipboardQueue || Promise.resolve();
  let release!: () => void;
  global.__extractImageClipboardQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function executePasteImageClipboard(
  page: Page,
  params: PasteImageClipboardParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];

  try {
    const normalizeImageUrls = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        return value.map((v) => String(v || '').trim()).filter(Boolean);
      }
      const text = String(value || '').trim();
      if (!text) return [];
      if (text.startsWith('[')) {
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) {
            return parsed.map((v) => String(v || '').trim()).filter(Boolean);
          }
        } catch {
          // ignore and fallback to split mode
        }
      }
      return text
        .split(/[\n,]/)
        .map((v) => v.trim())
        .filter(Boolean);
    };

    const imageUrls = normalizeImageUrls(params.imageUrls);
    if (imageUrls.length === 0) {
      const fallback = String(params.imageUrl || '').trim();
      if (fallback) imageUrls.push(fallback);
    }
    const targetSelector = String(params.targetSelector || '').trim();
    const waitAfterPaste = Math.max(0, Number(params.waitAfterPaste ?? 1200) || 1200);
    const attachIndicatorSelector = String(params.attachIndicatorSelector || '').trim();
    const outputVar = String(params.outputVar || 'pastedImageUrls').trim();

    if (imageUrls.length === 0) {
      log.push('⏭️ imageUrls 为空，自动跳过图片粘贴');
      const screenshot = await captureScreenshot(page);
      return {
        success: true,
        log,
        screenshot,
        output: {
          [outputVar]: [],
          imageUrls: [],
          imageCount: 0,
        },
      };
    }
    if (!targetSelector) {
      throw new Error('targetSelector 不能为空');
    }

    await withClipboardLock(async () => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      const target = page.locator(targetSelector).first();
      await target.waitFor({ state: 'visible', timeout: 15_000 });

      for (let i = 0; i < imageUrls.length; i++) {
        const imageUrl = imageUrls[i];
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`第 ${i + 1} 张下载失败：HTTP ${response.status}`);
        }
        const contentTypeRaw = response.headers.get('content-type') || '';
        const mimeType = contentTypeRaw.split(';')[0].trim() || 'image/png';
        if (!mimeType.startsWith('image/')) {
          throw new Error(`第 ${i + 1} 张非图片资源：content-type=${contentTypeRaw || 'unknown'}`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length === 0) {
          throw new Error(`第 ${i + 1} 张图片内容为空`);
        }

        await page.evaluate(
          async ({ buffer, type }) => {
            if (typeof navigator === 'undefined' || !navigator.clipboard || typeof ClipboardItem === 'undefined') {
              throw new Error('当前页面不支持 Clipboard API');
            }
            await navigator.clipboard.writeText('');

            const rawBlob = new Blob([new Uint8Array(buffer)], { type });
            const writeClipboard = async (blob: Blob, mime: string) => {
              const item = new ClipboardItem({ [mime]: blob });
              await navigator.clipboard.write([item]);
            };

            try {
              await writeClipboard(rawBlob, type);
              return;
            } catch {
              // 某些站点/浏览器仅接受 image/png，继续转码兜底
            }

            const bitmap = await createImageBitmap(rawBlob);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              throw new Error('无法创建 Canvas 2D 上下文');
            }
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            const pngBlob = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((b) => {
                if (!b) return reject(new Error('图片转 PNG 失败'));
                resolve(b);
              }, 'image/png');
            });
            await writeClipboard(pngBlob, 'image/png');
          },
          { buffer: Array.from(bytes), type: mimeType }
        );

        log.push(`📋 [${i + 1}/${imageUrls.length}] 已写入剪贴板：${(bytes.length / 1024).toFixed(1)} KB (${mimeType})`);
        ctx.emit?.('log', `📋 已注入第 ${i + 1} 张图片到剪贴板`);

        await target.click({ timeout: 15_000 });
        await page.keyboard.press('ControlOrMeta+V');
        await page.waitForTimeout(waitAfterPaste);
        log.push(`✅ [${i + 1}/${imageUrls.length}] 已执行粘贴`);

        if (attachIndicatorSelector) {
          const attached = await page
            .locator(attachIndicatorSelector)
            .first()
            .isVisible({ timeout: 10_000 })
            .catch(() => false);
          if (!attached) {
            throw new Error(`第 ${i + 1} 张粘贴后未检测到附件标识：${attachIndicatorSelector}`);
          }
          log.push(`✅ [${i + 1}/${imageUrls.length}] 附件标识校验通过`);
        }
      }
    });

    if (ctx.vars) {
      ctx.vars[outputVar] = JSON.stringify(imageUrls);
    }

    const screenshot = await captureScreenshot(page);
    return {
      success: true,
      log,
      screenshot,
      output: {
        [outputVar]: imageUrls,
        imageUrls,
        imageUrl: imageUrls[0] || '',
        imageCount: imageUrls.length,
      },
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.push(`❌ 图片粘贴失败: ${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  }
}
