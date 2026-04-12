import type { Page, Locator } from 'playwright';
import type { NodeResult, PasteImageClipboardParams, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import { withSystemClipboardLock } from '../clipboard-lock';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

type DownloadedImage = {
  url: string;
  mimeType: string;
  bytes: Uint8Array;
  base64: string;
  filePath: string;
};

const DEFAULT_ATTACHMENT_SELECTOR = [
  // 以“缩略图/图片预览”来判断
  'img[src^="blob:"]',
  'img[src^="data:image"]',
  // 以“移除/删除附件”按钮或语义来判断
  '[aria-label*="Remove image" i]',
  '[aria-label*="Remove" i]',
  '[aria-label*="删除"]',
  '[aria-label*="移除"]',
  // 常见的 attachment/testid/class 命名
  '[data-testid*="attachment" i]',
  '[data-test-id*="attachment" i]',
  '[data-testid*="image" i]',
  '[data-test-id*="image" i]',
  '[class*="attachment" i]',
  '[class*="thumbnail" i]',
].join(', ');

function extFromMime(mimeType: string): string {
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'png';
}

export async function executePasteImageClipboard(
  page: Page,
  params: PasteImageClipboardParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  const tempFiles: string[] = [];

  try {
    const normalizeImageUrls = (value: unknown): string[] => {
      // 允许三种输入：
      // 1) string：逗号/换行分隔，或 JSON 数组字符串
      // 2) string[]：数组内也允许出现逗号/换行分隔（例如 ['url1, url2']），这里做扁平化
      // 3) unknown：兜底转 string
      const splitTokens = (raw: string): string[] =>
        String(raw || '')
          .split(/[\n,]/)
          .map((v) => v.trim())
          .filter(Boolean);

      if (Array.isArray(value)) {
        return value
          .flatMap((v) => splitTokens(String(v || '')))
          .filter(Boolean);
      }

      const text = String(value || '').trim();
      if (!text) return [];

      if (text.startsWith('[')) {
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) {
            return parsed.flatMap((v) => splitTokens(String(v || ''))).filter(Boolean);
          }
        } catch {
          // ignore and fallback to split mode
        }
      }

      return splitTokens(text);
    };

    const imageUrls = normalizeImageUrls(params.imageUrls);
    if (imageUrls.length === 0) {
      const fallback = String(params.imageUrl || '').trim();
      if (fallback) imageUrls.push(fallback);
    }

    const targetSelector = String((params as Partial<PasteImageClipboardParams>).targetSelector || '').trim();
    const waitAfterPaste = Math.max(0, Number(params.waitAfterPaste ?? 1200) || 1200);
    const outputVar = String(params.outputVar || 'pastedImageUrls').trim();

    const verifyAttachment = params.verifyAttachment ?? true;
    const uploadFallback = params.uploadFallback ?? true;
    const waitAfterUpload = Math.max(0, Number(params.waitAfterUpload ?? 2500) || 2500);

    const attachIndicatorSelectorRaw = String(params.attachIndicatorSelector || '').trim();
    const attachIndicatorSelector = attachIndicatorSelectorRaw || DEFAULT_ATTACHMENT_SELECTOR;

    const openUploaderSelector = String(params.openUploaderSelector || '').trim();
    const fileInputSelector = String(params.fileInputSelector || '').trim() || 'input[type="file"]';

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

    const resolveTarget = async (): Promise<{ target: Locator; selectorUsed: string; fallback: boolean }> => {
      if (targetSelector) {
        const loc = page.locator(targetSelector).first();
        const ok = await loc.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
        if (ok) return { target: loc, selectorUsed: targetSelector, fallback: false };
        log.push(`⚠️ 未找到输入框：${targetSelector}，尝试自动定位...`);
      }
      const loc = page.locator('textarea:visible, [contenteditable="true"]:visible, input[type="text"]:visible').last();
      await loc.waitFor({ state: 'visible', timeout: 15_000 });
      return { target: loc, selectorUsed: '(auto)', fallback: true };
    };

    const downloadToTemp = async (url: string, index: number): Promise<DownloadedImage> => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`第 ${index + 1} 张下载失败：HTTP ${response.status}`);
      }
      const contentTypeRaw = response.headers.get('content-type') || '';
      const mimeType = contentTypeRaw.split(';')[0].trim() || 'image/png';
      if (!mimeType.startsWith('image/')) {
        throw new Error(`第 ${index + 1} 张非图片资源：content-type=${contentTypeRaw || 'unknown'}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0) {
        throw new Error(`第 ${index + 1} 张图片内容为空`);
      }

      const base64 = Buffer.from(bytes).toString('base64');

      const dir = path.join(os.tmpdir(), 'doouyin-workflow-attachments');
      await fs.mkdir(dir, { recursive: true });
      const ext = extFromMime(mimeType);
      const filePath = path.join(dir, `img-${Date.now()}-${crypto.randomUUID()}.${ext}`);
      await fs.writeFile(filePath, bytes);
      tempFiles.push(filePath);

      log.push(`⬇️ [${index + 1}/${imageUrls.length}] 已下载图片：${(bytes.length / 1024).toFixed(1)} KB (${mimeType})`);
      return { url, mimeType, bytes, base64, filePath };
    };

    const { target, selectorUsed, fallback } = await resolveTarget();
    log.push(`🎯 定位输入框：${selectorUsed}${fallback ? '（自动定位）' : ''}`);

    const targetHandle = await target.elementHandle();
    if (!targetHandle) throw new Error('无法获取输入框元素句柄');

    const rootHandle = (await targetHandle.evaluateHandle((el) => {
      return (
        el.closest('form') ||
        el.closest('footer') ||
        el.closest('[role="dialog"]') ||
        el.closest('main') ||
        document.body
      );
    })) as any;

    const getAttachmentSnapshot = async (): Promise<{ count: number; signature: string }> => {
      if (!verifyAttachment) return { count: 0, signature: '' };
      const selector = attachIndicatorSelector;
      const data = await rootHandle
        .evaluate((root: any, sel: string) => {
          try {
            const nodes = Array.from(root?.querySelectorAll?.(sel) ?? []) as any[];
            const signatureParts = nodes.map((el) => {
              const tag = String(el?.tagName || '').toLowerCase();
              const src = (el?.getAttribute && el.getAttribute('src')) || '';
              const aria = (el?.getAttribute && el.getAttribute('aria-label')) || '';
              const testid = (el?.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test-id'))) || '';
              const cls = (el?.getAttribute && el.getAttribute('class')) || '';
              return [tag, src, aria, testid, cls].filter(Boolean).join('#');
            });
            return { count: nodes.length, signature: signatureParts.join('|') };
          } catch {
            return { count: 0, signature: '' };
          }
        }, selector)
        .catch(() => ({ count: 0, signature: '' }));
      return { count: Number(data?.count || 0), signature: String(data?.signature || '') };
    };

    const downloaded: DownloadedImage[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      downloaded.push(await downloadToTemp(imageUrls[i], i));
    }

    let attachedVia: 'clipboard' | 'upload' = 'clipboard';

    const verifyIncrease = async (
      before: { count: number; signature: string },
      expectedIncrease: number,
      stage: string,
      timeoutMs: number
    ) => {
      if (!verifyAttachment) return;

      const start = Date.now();
      let last = before;
      while (Date.now() - start < timeoutMs) {
        const after = await getAttachmentSnapshot();
        last = after;

        const countOk = after.count >= before.count + expectedIncrease;
        // 允许“替换型附件”：计数不变，但签名变化（例如 before=1 after=1）
        const replacedOk = after.count >= before.count && after.signature && after.signature !== before.signature;

        if (countOk || replacedOk) {
          log.push(`✅ 附件校验通过：before=${before.count} → after=${after.count}${replacedOk && !countOk ? '（替换模式）' : ''}`);
          return;
        }
        await page.waitForTimeout(300);
      }

      throw new Error(
        `${stage} 后未检测到附件出现/变化（before=${before.count}, after=${last.count}, expectedIncrease>=${expectedIncrease}）。` +
          `可通过 attachIndicatorSelector 精准配置，或临时关闭 verifyAttachment。`
      );
    };

    const tryClipboardPaste = async () => {
      await withSystemClipboardLock(async () => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

        let beforeSnap = await getAttachmentSnapshot();
        if (verifyAttachment) {
          log.push(`🔎 附件计数（执行前）：${beforeSnap.count}`);
        }

        for (let i = 0; i < downloaded.length; i++) {
          const img = downloaded[i];

          await page.evaluate(
            async ({ base64, type }) => {
              if (typeof navigator === 'undefined' || !navigator.clipboard || typeof ClipboardItem === 'undefined') {
                throw new Error('当前页面不支持 Clipboard API');
              }

              const bin = atob(base64);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) {
                bytes[i] = bin.charCodeAt(i);
              }

              const rawBlob = new Blob([bytes], { type });
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
            { base64: img.base64, type: img.mimeType }
          );

          log.push(`📋 [${i + 1}/${downloaded.length}] 已写入剪贴板：${img.mimeType}`);
          ctx.emit?.('log', `📋 已注入第 ${i + 1} 张图片到剪贴板`);

          await target.click({ timeout: 15_000 });
          await page.keyboard.press('ControlOrMeta+V');
          await page.waitForTimeout(waitAfterPaste);
          log.push(`✅ [${i + 1}/${downloaded.length}] 已执行粘贴`);

          await verifyIncrease(beforeSnap, 1, `第 ${i + 1} 张粘贴`, Math.max(4000, waitAfterPaste * 4));
          beforeSnap = await getAttachmentSnapshot();
        }
      });
    };

    try {
      await tryClipboardPaste();
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      log.push(`⚠️ 剪贴板粘贴未生效：${err}`);

      if (!uploadFallback) {
        throw e;
      }

      attachedVia = 'upload';
      log.push('🪄 尝试降级：下载到本地后通过 file input 上传...');

      let before = await getAttachmentSnapshot();
      if (verifyAttachment) log.push(`🔎 附件计数（上传前）：${before.count}`);

      if (openUploaderSelector) {
        const clicked = await page
          .locator(openUploaderSelector)
          .first()
          .click({ timeout: 5000 })
          .then(() => true)
          .catch(() => false);
        log.push(clicked ? `🧩 已点击打开上传器：${openUploaderSelector}` : `⚠️ 打开上传器失败：${openUploaderSelector}`);
      }

      const tryRevealFileInput = async (): Promise<boolean> => {
        const sel = fileInputSelector || 'input[type="file"], input[type="file"][accept*="image" i]';
        const ok = await page.locator(sel).first().waitFor({ state: 'attached', timeout: 1200 }).then(() => true).catch(() => false);
        if (ok) return true;

        // 没传 openUploaderSelector 时，做一轮启发式点击，常见于 Gemini（先点“添加图片/上传”才挂 input）
        const candidates = [
          'button:has-text("Upload")',
          'button:has-text("上传")',
          'button:has-text("Add image")',
          'button:has-text("添加图片")',
          'button:has-text("Insert")',
          'button:has-text("插入")',
          '[aria-label*="upload" i]',
          '[aria-label*="image" i]',
          '[aria-label*="photo" i]',
          '[aria-label*="图片" i]',
          '[aria-label*="照片" i]',
        ];

        for (const cand of candidates) {
          const btn = page.locator(cand).first();
          const clicked = await btn.click({ timeout: 800 }).then(() => true).catch(() => false);
          if (!clicked) continue;
          const appeared = await page.locator(sel).first().waitFor({ state: 'attached', timeout: 1200 }).then(() => true).catch(() => false);
          if (appeared) {
            log.push(`🧩 自动打开上传器成功：${cand}`);
            return true;
          }
        }

        return false;
      };

      const revealed = await tryRevealFileInput();
      if (!revealed) {
        throw new Error(
          `未找到 file input（selector=${fileInputSelector || 'input[type=file]'}）。` +
            `请配置 openUploaderSelector（先点开上传入口）或 fileInputSelector（定位真实 input）。`
        );
      }

      const inputSel = fileInputSelector || 'input[type="file"], input[type="file"][accept*="image" i]';
      const input = page.locator(inputSel).first();
      await input.waitFor({ state: 'attached', timeout: 15_000 });

      for (let i = 0; i < downloaded.length; i++) {
        const filePath = downloaded[i].filePath;
        await input.setInputFiles(filePath);
        log.push(`📎 [${i + 1}/${downloaded.length}] 已 setInputFiles：${path.basename(filePath)}（${fileInputSelector}）`);

        await page.waitForTimeout(waitAfterUpload);
        await verifyIncrease(before, 1, `第 ${i + 1} 张文件上传`, Math.max(6000, waitAfterUpload * 4));
        before = await getAttachmentSnapshot();
      }
    }

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
        attachedVia,
        localPaths: downloaded.map((d) => d.filePath),
        verifyAttachment,
        attachIndicatorSelector: attachIndicatorSelectorRaw || '(default)',
      },
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.push(`❌ 图片粘贴失败: ${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  } finally {
    // 清理临时文件（不影响 setInputFiles 的读取）
    await Promise.all(
      tempFiles.map((p) => fs.unlink(p).catch(() => undefined))
    );
  }
}
