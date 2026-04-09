import type { Page } from 'playwright';
import type { NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import { uploadBuffer } from '../../oss';

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

    // ── 步骤 1：定位并点击"复制图片"按钮 ──────────────────────────────
    log.push(`🖱️ 正在查找复制按钮：${copyButtonSelector}`);
    ctx.emit?.('log', `🖱️ 正在查找复制按钮...`);

    await page.waitForSelector(copyButtonSelector, { timeout: copyButtonTimeout });
    await page.click(copyButtonSelector);
    log.push(`✅ 已点击复制按钮`);

    // ── 步骤 2：等待剪贴板就绪 ─────────────────────────────────────────
    log.push(`⏳ 等待剪贴板就绪（${waitAfterCopy}ms）...`);
    ctx.emit?.('log', `⏳ 等待剪贴板就绪...`);
    await page.waitForTimeout(waitAfterCopy);

    // ── 步骤 3：通过浏览器 Clipboard API 读取图片数据 ─────────────────
    log.push(`💾 正在从浏览器剪贴板读取图片数据...`);
    ctx.emit?.('log', `💾 从浏览器剪贴板读取图片数据...`);

    const { data: imageDataArray, mimeType } = await readImageFromBrowserClipboard(page);
    const imageBuffer = Buffer.from(imageDataArray);
    const sizeKB = (imageBuffer.length / 1024).toFixed(2);
    log.push(`✅ 读取成功（格式: ${mimeType}）`);
    log.push(`✅ 图片提取成功：${sizeKB} KB（原始分辨率）`);
    ctx.emit?.('log', `✅ 图片 ${sizeKB} KB`);

    // ── 步骤 4：上传到 OSS ────────────────────────────────────────────
    let imageUrl = '';

    if (uploadToOSS) {
      log.push(`☁️ 正在上传到 OSS：${ossPath}`);
      ctx.emit?.('log', `☁️ 正在上传到 OSS...`);

      imageUrl = await uploadBuffer(imageBuffer, ossPath, 'image/png');
      log.push(`✅ 上传成功：${imageUrl}`);
      ctx.emit?.('log', `✅ 图片地址：${imageUrl}`);
    }

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
