import type { Page } from 'playwright';
import type { FileUploadParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import os from 'os';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { pipeline } from 'node:stream/promises';

/** 下载 URL 到本地临时文件，返回临时文件路径 */
async function downloadToTemp(url: string, tmpFile: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const request = proto.get(url, res => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`下载失败 HTTP ${res.statusCode}`));
        return;
      }
      pipeline(res, fs.createWriteStream(tmpFile, { flags: 'wx', mode: 0o600 }))
        .then(resolve, reject);
    }).on('error', reject);
    request.setTimeout(60_000, () => request.destroy(new Error('视频下载超时')));
  });
}

export async function executeFileUpload(
  page: Page,
  params: FileUploadParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  let tmpFile = '';
  let tmpDir = '';

  try {
    const url = params.url;
    log.push(`⬇️ 下载视频：${url.slice(-50)}`);
    ctx.emit?.('log', `⬇️ 下载视频中...`);

    const source = new URL(url);
    if (!['https:', 'http:'].includes(source.protocol)) throw new Error('视频地址必须是 HTTP(S)');
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wf-upload-'));
    tmpFile = path.join(tmpDir, 'video' + (path.extname(source.pathname) || '.mp4'));
    await downloadToTemp(url, tmpFile);
    log.push(`✅ 下载完成：${path.basename(tmpFile)}`);

    log.push(`📤 注入文件到上传控件：${params.selector}`);
    const input = page.locator(params.selector).first();
    await input.waitFor({ state: 'attached', timeout: 15_000 });
    await input.setInputFiles(tmpFile);

    if (new URL(page.url()).origin === 'https://creator.douyin.com') {
      ctx.emit?.('log', '等待抖音实际上传完成，完成前保留临时文件');
      await page.waitForFunction(() => {
        const text = document.body.innerText;
        return location.pathname.includes('/login') || (/扫码登录/.test(text) && /验证码登录/.test(text)) ||
          /上传失败|上传出错|文件损坏/.test(text) ||
          (!/取消上传/.test(text) && /上传成功|重新上传/.test(text));
      }, null, { timeout: 600000 });
      const uploadText = await page.locator('body').innerText();
      if (new URL(page.url()).pathname.includes('/login') || (/扫码登录/.test(uploadText) && /验证码登录/.test(uploadText))) {
        throw new Error('creator_login_lost_during_upload');
      }
      if (/上传失败|上传出错|文件损坏/.test(uploadText)) {
        throw new Error('video_upload_failed');
      }
    }

    await page.waitForTimeout(2000);
    log.push(`✅ 文件上传触发成功`);

    const screenshot = await captureScreenshot(page);
    return { success: true, log, screenshot, output: { tmpFile, uploadedSourceUrl: params.url } };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.push(`❌ 文件上传失败: ${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  } finally {
    // A local browser may read the selected path asynchronously after setInputFiles.
    // For Douyin, keep it until the actual upload finishes (or this node fails).
    // Own the directory before download starts, including partial-file failures.
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      ctx.emit?.('log', '🧹 本节点临时上传文件已清理');
    }
  }
}
