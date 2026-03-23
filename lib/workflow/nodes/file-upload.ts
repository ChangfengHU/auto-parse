import type { Page } from 'playwright';
import type { FileUploadParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import os from 'os';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';

/** 下载 URL 到本地临时文件，返回临时文件路径 */
async function downloadToTemp(url: string): Promise<string> {
  const ext = path.extname(new URL(url).pathname) || '.mp4';
  const tmpFile = path.join(os.tmpdir(), `wf-upload-${Date.now()}${ext}`);

  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(tmpFile);
    proto.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`下载失败 HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(tmpFile)));
    }).on('error', reject);
  });
}

export async function executeFileUpload(
  page: Page,
  params: FileUploadParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  let tmpFile = '';

  try {
    const url = params.url;
    log.push(`⬇️ 下载视频：${url.slice(-50)}`);
    ctx.emit?.('log', `⬇️ 下载视频中...`);

    tmpFile = await downloadToTemp(url);
    log.push(`✅ 下载完成：${path.basename(tmpFile)}`);

    log.push(`📤 注入文件到上传控件：${params.selector}`);
    const input = page.locator(params.selector).first();
    await input.waitFor({ state: 'attached', timeout: 15_000 });
    await input.setInputFiles(tmpFile);

    await page.waitForTimeout(2000);
    log.push(`✅ 文件上传触发成功`);

    const screenshot = await captureScreenshot(page);
    return { success: true, log, screenshot, output: { tmpFile } };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.push(`❌ 文件上传失败: ${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  } finally {
    // 延迟清理临时文件（上传可能还在进行）
    if (tmpFile) {
      setTimeout(() => {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      }, 300_000); // 5 分钟后清理
    }
  }
}
