import type { Page } from 'playwright';
import type { ExtractImageParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import { uploadBuffer } from '../../oss';
import os from 'os';
import path from 'path';
import fs from 'fs';

export async function executeExtractImage(
  page: Page,
  params: ExtractImageParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  let localFile = '';

  try {
    const selector = params.selector || 'img';
    const index = params.index ?? 0;
    const uploadToOSS = params.uploadToOSS ?? true;
    const outputVar = params.outputVar || 'imageUrl';

    log.push(`🔍 查找图片元素：${selector}`);
    ctx.emit?.('log', `🔍 正在查找图片...`);

    // 等待图片元素出现
    const elements = page.locator(selector);
    const count = await elements.count();
    
    if (count === 0) {
      throw new Error(`未找到匹配的图片元素：${selector}`);
    }

    if (index >= count) {
      throw new Error(`索引 ${index} 超出范围，共找到 ${count} 个图片`);
    }

    const targetElement = elements.nth(index);
    log.push(`✅ 找到 ${count} 个图片，选择第 ${index + 1} 个`);

    // 滚动到元素位置，触发懒加载
    try {
      log.push(`📜 滚动到图片位置，触发懒加载...`);
      await targetElement.scrollIntoViewIfNeeded();
      await page.waitForTimeout(2000); // 等待图片加载
    } catch (e) {
      log.push(`⚠️ 滚动失败，继续处理：${e instanceof Error ? e.message : String(e)}`);
    }

    // 方案1：尝试获取图片的真实 URL 并下载
    let imageUrl: string | null = null;
    let imageBuffer: Buffer | null = null;

    try {
      // 尝试多个属性获取真实图片 URL（优先级顺序）
      const srcAttrs = ['data-src', 'data-original', 'data-lazy-src', 'src'];
      let realSrc: string | null = null;

      for (const attr of srcAttrs) {
        const value = await targetElement.getAttribute(attr);
        if (value && !value.startsWith('data:')) {
          realSrc = value;
          log.push(`📎 从 ${attr} 获取图片 URL: ${realSrc.slice(0, 80)}...`);
          break;
        }
      }

      if (realSrc) {
        // 如果是相对路径，转换为绝对路径
        const absoluteUrl = new URL(realSrc, page.url()).href;
        
        // 使用 Playwright 的 page.request 获取图片（自动处理 cookies 和 headers）
        const response = await page.request.get(absoluteUrl);
        
        if (response.ok()) {
          imageBuffer = await response.body();
          log.push(`✅ 下载图片成功：${(imageBuffer.length / 1024).toFixed(2)} KB`);
        } else {
          log.push(`⚠️ 下载图片失败 (HTTP ${response.status()})，尝试截图方式`);
        }
      } else {
        log.push(`⚠️ 未找到有效的图片 URL（所有属性都是 data: URL），使用截图方式`);
      }
    } catch (e) {
      log.push(`⚠️ 下载图片失败，使用截图方式：${e instanceof Error ? e.message : String(e)}`);
    }

    // 方案2（fallback）：直接截图该元素
    if (!imageBuffer) {
      log.push(`📸 使用元素截图方式...`);
      ctx.emit?.('log', `📸 正在截图...`);
      
      imageBuffer = await targetElement.screenshot({ type: 'jpeg', quality: 90 });
      log.push(`✅ 截图成功：${(imageBuffer.length / 1024).toFixed(2)} KB`);
    }

    // 上传到 OSS
    if (uploadToOSS) {
      log.push(`☁️ 正在上传到 OSS...`);
      ctx.emit?.('log', `☁️ 正在上传到 OSS...`);

      // 处理 ossPath 中的模板变量
      let ossPath = params.ossPath || `extract-images/${Date.now()}.jpg`;
      ossPath = ossPath.replace(/\{\{timestamp\}\}/g, String(Date.now()));
      
      // 上传
      imageUrl = await uploadBuffer(imageBuffer, ossPath, 'image/jpeg');
      log.push(`✅ 上传成功：${imageUrl}`);
      
      // 保存到上下文变量
      if (ctx.vars) {
        ctx.vars[outputVar] = imageUrl;
      }
    } else {
      // 只保存到本地临时文件
      localFile = path.join(os.tmpdir(), `extract-${Date.now()}.jpg`);
      fs.writeFileSync(localFile, imageBuffer);
      imageUrl = localFile;
      log.push(`💾 保存到本地：${localFile}`);
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
      },
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.push(`❌ 提取图片失败: ${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  } finally {
    // 清理本地临时文件（如果有）
    if (localFile && fs.existsSync(localFile)) {
      setTimeout(() => {
        try {
          fs.unlinkSync(localFile);
        } catch {
          /* ignore */
        }
      }, 60_000); // 1分钟后删除
    }
  }
}
