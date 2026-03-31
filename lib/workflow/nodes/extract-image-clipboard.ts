import type { Page } from 'playwright';
import type { NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import { uploadBuffer } from '../../oss';
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

/** 节点参数 */
export interface ExtractImageClipboardParams {
  /** 触发复制的按钮选择器，默认为 Gemini 的"复制图片"按钮 */
  copyButtonSelector?: string;
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
 * 将剪贴板中的图片数据（PNG 格式）保存到临时文件
 * 使用 macOS 原生 AppleScript 读取系统剪贴板
 */
function saveClipboardImage(outputPath: string): void {
  // 通过 osascript 读取剪贴板的 PNG 原始二进制数据并写入文件
  const script = [
    'try',
    '  set theData to the clipboard as «class PNGf»',
    `  set outFile to open for access POSIX file "${outputPath}" with write permission`,
    '  write theData to outFile',
    '  close access outFile',
    `  return "${outputPath}"`,
    'on error errMsg',
    '  return "error: " & errMsg',
    'end try',
  ].join('\n');

  const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf8',
    timeout: 15_000,
  }).trim();

  if (result.startsWith('error:')) {
    throw new Error(`剪贴板读取失败: ${result}`);
  }
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
  let tmpFile = '';

  try {
    // 解析参数
    const copyButtonSelector = params.copyButtonSelector || '[aria-label="Copy image"]';
    const waitAfterCopy = params.waitAfterCopy ?? 3000;
    const uploadToOSS = params.uploadToOSS ?? true;
    const outputVar = params.outputVar || 'imageUrl';

    // 处理 ossPath 中的 {{timestamp}} 模板变量
    let ossPath = params.ossPath || `gemini-images/{{timestamp}}.png`;
    ossPath = ossPath.replace(/\{\{timestamp\}\}/g, String(Date.now()));

    // ── 步骤 1：定位并点击"复制图片"按钮 ──────────────────────────────
    log.push(`🖱️ 正在查找复制按钮：${copyButtonSelector}`);
    ctx.emit?.('log', `🖱️ 正在查找复制按钮...`);

    await page.waitForSelector(copyButtonSelector, { timeout: 10_000 });
    await page.click(copyButtonSelector);
    log.push(`✅ 已点击复制按钮`);

    // ── 步骤 2：等待剪贴板就绪 ─────────────────────────────────────────
    log.push(`⏳ 等待剪贴板就绪（${waitAfterCopy}ms）...`);
    ctx.emit?.('log', `⏳ 等待剪贴板就绪...`);
    await page.waitForTimeout(waitAfterCopy);

    // ── 步骤 3：通过 osascript 从剪贴板读取 PNG 原始数据 ──────────────
    tmpFile = path.join(os.tmpdir(), `gemini-clipboard-${Date.now()}.png`);
    log.push(`💾 正在从剪贴板保存图片到临时文件...`);
    ctx.emit?.('log', `💾 从剪贴板读取图片数据...`);

    saveClipboardImage(tmpFile);

    if (!fs.existsSync(tmpFile)) {
      throw new Error('剪贴板图片保存失败：临时文件不存在');
    }

    const imageBuffer = fs.readFileSync(tmpFile);
    const sizeKB = (imageBuffer.length / 1024).toFixed(2);
    log.push(`✅ 图片提取成功：${sizeKB} KB（原始分辨率）`);
    ctx.emit?.('log', `✅ 图片 ${sizeKB} KB`);

    // ── 步骤 4：上传到 OSS ────────────────────────────────────────────
    let imageUrl: string = tmpFile;

    if (uploadToOSS) {
      log.push(`☁️ 正在上传到 OSS：${ossPath}`);
      ctx.emit?.('log', `☁️ 正在上传到 OSS...`);

      imageUrl = await uploadBuffer(imageBuffer, ossPath, 'image/png');
      log.push(`✅ 上传成功：${imageUrl}`);
    }

    // 写入上下文变量供后续节点使用
    if (ctx.vars) {
      ctx.vars[outputVar] = imageUrl;
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
  } finally {
    // 延迟清理临时文件
    if (tmpFile && fs.existsSync(tmpFile)) {
      setTimeout(() => {
        try { fs.unlinkSync(tmpFile); } catch { /* 忽略 */ }
      }, 60_000);
    }
  }
}
