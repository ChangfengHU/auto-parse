import type { Page } from 'playwright';
import type { NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import { uploadBuffer } from '../../oss';

declare global {
  // 串行化“清空剪贴板 -> 复制图片 -> 读取剪贴板 -> 上传”，避免并发实例互相覆盖
  var __extractImageClipboardQueue: Promise<void> | undefined;
}

/** 节点参数 */
export interface ExtractImageClipboardParams {
  /** 触发复制的按钮选择器，默认为 Gemini 的"复制图片"按钮 */
  copyButtonSelector?: string;
  /** 查找复制按钮超时（ms），默认 60000 */
  copyButtonTimeout?: number;
  /** 点击复制按钮后等待剪贴板就绪的时间（ms），默认 3000 */
  waitAfterCopy?: number;
  /** 是否上传到 OSS（默认 true） */
  uploadToOSS?: boolean;
  /** OSS 存储路径，支持 {{timestamp}} 模板 */
  ossPath?: string;
  /** 输出变量名（默认：imageUrl） */
  outputVar?: string;
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

async function clearClipboard(page: Page): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async () => {
    await navigator.clipboard.writeText('');
  });
}

async function clipboardHasImage(page: Page): Promise<boolean> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const hasImage = await page.evaluate(async () => {
    try {
      const items = await navigator.clipboard.read();
      return items.some((item) => item.types.some((t) => t.startsWith('image/')));
    } catch {
      return false;
    }
  });
  return hasImage;
}

/**
 * 在浏览器上下文内通过 Clipboard API 读取图片数据
 * 支持两种写入方式：
 *   1. image/png 二进制（标准）
 *   2. text/html 内嵌 <img src="blob:...">（Gemini 等平台）
 */
async function readImageFromBrowserClipboard(page: Page): Promise<{ data: number[]; mimeType: string }> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  const result = await page.evaluate(async (): Promise<{ data: number[]; mimeType: string } | { error: string }> => {
    try {
      const items = await navigator.clipboard.read();
      const allTypes = items.flatMap(i => i.types);

      // 方式 1：直接 image/* 二进制
      for (const item of items) {
        const imgType = item.types.includes('image/png')
          ? 'image/png'
          : item.types.find(t => t.startsWith('image/'));
        if (!imgType) continue;
        const blob = await item.getType(imgType);
        const buf = await blob.arrayBuffer();
        return { data: Array.from(new Uint8Array(buf)), mimeType: imgType };
      }

      // 方式 2：text/html 中内嵌 <img src="blob:..."> 或 <img src="data:...">（Gemini 等）
      for (const item of items) {
        if (!item.types.includes('text/html')) continue;
        const htmlBlob = await item.getType('text/html');
        const html = await htmlBlob.text();
        const match = html.match(/src="((?:blob|data|https?)[^"]+)"/i);
        if (!match) continue;
        const src = match[1];
        try {
          const res = await fetch(src);
          const buf = await res.arrayBuffer();
          const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
          return { data: Array.from(new Uint8Array(buf)), mimeType };
        } catch {
          continue;
        }
      }

      return { error: `剪贴板中未找到图片数据（支持的类型：${allTypes.join(', ')}）` };
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  if ('error' in result) throw new Error(result.error);
  return result;
}

/**
 * 高清图片提取节点（剪贴板中转方案）
 *
 * 解决了 Gemini 等平台使用 blob: URL 导致图片无法直接下载的问题。
 * 通过模拟点击页面上的"复制图片"按钮，将原始图片数据写入系统剪贴板，
 * 再通过 macOS 的 osascript 读取剪贴板并保存为本地 PNG 文件。
 *
 * 对比截图方案（35KB 模糊），此方案可保留图片原始分辨率（~1MB 高清）。
 */
export async function executeExtractImageClipboard(
  page: Page,
  params: ExtractImageClipboardParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];

  try {
    // 解析参数
    const copyButtonSelector = params.copyButtonSelector || '[aria-label="Copy image"]';
    const copyButtonTimeout = params.copyButtonTimeout ?? 60_000;
    const waitAfterCopy = params.waitAfterCopy ?? 3000;
    const uploadToOSS = params.uploadToOSS ?? true;
    const outputVar = params.outputVar || 'imageUrl';

    // 处理 ossPath 中的 {{timestamp}} 模板变量
    let ossPath = params.ossPath || `gemini-images/{{timestamp}}.png`;
    ossPath = ossPath.replace(/\{\{timestamp\}\}/g, String(Date.now()));

    const maxCopyRetries = 3;
    const { imageBuffer, sizeKB, imageUrl } = await withClipboardLock(async () => {
      // ── 步骤 1：定位复制按钮（加锁后执行，避免并发串图）──────────────────
      log.push(`🔒 已获取剪贴板锁`);
      log.push(`🖱️ 正在查找复制按钮：${copyButtonSelector}`);
      ctx.emit?.('log', `🖱️ 正在查找复制按钮...`);
      await page.waitForSelector(copyButtonSelector, { timeout: copyButtonTimeout });

      let copiedBuffer: Buffer | null = null;
      let copiedMime = 'image/png';
      for (let attempt = 1; attempt <= maxCopyRetries; attempt++) {
        // 步骤 2：复制前先清空并确认剪贴板不含图片，减少其他实例残留干扰
        await clearClipboard(page);
        log.push(`🧹 已清空剪贴板（尝试 ${attempt}/${maxCopyRetries}）`);
        await page.waitForTimeout(120);
        const hasImageAfterClear = await clipboardHasImage(page);
        if (hasImageAfterClear) {
          log.push(`⚠️ 清空后剪贴板仍含图片数据（尝试 ${attempt}/${maxCopyRetries}）`);
        }

        await page.click(copyButtonSelector);
        log.push(`✅ 已点击复制按钮（尝试 ${attempt}/${maxCopyRetries}）`);
        const pollEndAt = Date.now() + waitAfterCopy;
        while (Date.now() < pollEndAt) {
          try {
            const { data: imageDataArray, mimeType } = await readImageFromBrowserClipboard(page);
            copiedBuffer = Buffer.from(imageDataArray);
            copiedMime = mimeType || 'image/png';
            if (copiedBuffer.length > 0) {
              log.push(`✅ 复制校验通过（尝试 ${attempt}/${maxCopyRetries}）`);
              break;
            }
          } catch {
            // 轮询窗口内允许继续等待
          }
          await page.waitForTimeout(180);
        }

        if (copiedBuffer && copiedBuffer.length > 0) {
          break;
        }
        log.push(`⚠️ 复制校验失败（尝试 ${attempt}/${maxCopyRetries}）：剪贴板未出现可用图片`);
      }

      if (!copiedBuffer || copiedBuffer.length <= 0) {
        throw new Error(`复制后剪贴板无图片数据，重试 ${maxCopyRetries} 次仍失败`);
      }

      const kb = (copiedBuffer.length / 1024).toFixed(2);
      log.push(`✅ 图片提取成功：${kb} KB（格式: ${copiedMime}）`);
      ctx.emit?.('log', `✅ 图片 ${kb} KB`);

      // 步骤 4：上传到 OSS（锁内执行，上传完成后再释放）
      let uploaded = '';
      if (uploadToOSS) {
        log.push(`☁️ 正在上传到 OSS：${ossPath}`);
        ctx.emit?.('log', `☁️ 正在上传到 OSS...`);
        uploaded = await uploadBuffer(copiedBuffer, ossPath, copiedMime.includes('png') ? 'image/png' : copiedMime);
        log.push(`✅ 上传成功：${uploaded}`);
        ctx.emit?.('log', `✅ 图片地址：${uploaded}`);
      }

      log.push(`🔓 释放剪贴板锁`);
      return { imageBuffer: copiedBuffer, sizeKB: kb, imageUrl: uploaded };
    });

    // 写入上下文变量供后续节点使用
    if (ctx.vars) {
      ctx.vars[outputVar] = imageUrl;
      ctx.emit?.('log', `🧩 输出变量 ${outputVar} = ${imageUrl}`);
    }

    const screenshot = await captureScreenshot(page);
    return {
      success: true,
      log,
      screenshot,
      output: {
        imageUrl,
        [outputVar]: imageUrl,
        fileSize: imageBuffer.length,
        fileSizeKB: parseFloat(sizeKB),
      },
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.push(`❌ 剪贴板图片提取失败: ${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  }
}
