/**
 * localhost-image-download 节点 — 本地解析页面图片批量下载
 *
 * 专门用于下载已经在本地解析页面上显示的图片
 * 
 * 流程：
 *  1. 访问本地解析页面 (localhost:1007/analysis/xhs)
 *  2. 等待图片加载完成
 *  3. 批量右键下载所有图片
 *  4. 上传到OSS
 *  5. 返回OSS URL列表
 */

import type { Page } from 'playwright';
import type { NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import { uploadFromFile } from '../../oss';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface LocalhostImageDownloadParams {
  /** 解析页面URL，默认为 http://localhost:1007/analysis/xhs */
  pageUrl?: string;
  /** 图片容器选择器 */
  imageContainerSelector?: string;
  /** 图片选择器 */
  imageSelector?: string;
  /** 最大下载图片数量 */
  maxImages?: number;
  /** OSS上传路径前缀 */
  ossPrefix?: string;
  /** 输出变量名，存储OSS URL数组 */
  outputVar?: string;
  /** 单张图片下载超时时间（毫秒） */
  downloadTimeout?: number;
  /** 等待图片加载时间（毫秒） */
  waitTime?: number;
}

export async function executeLocalhostImageDownload(
  page: Page,
  params: LocalhostImageDownloadParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];

  // 解析参数
  const pageUrl = params.pageUrl || 'http://localhost:1007/analysis/xhs';
  const imageContainerSelector = params.imageContainerSelector || 'div.rounded-lg.overflow-hidden.border';
  const imageSelector = params.imageSelector || 'img';
  const maxImages = params.maxImages ?? 20;
  const ossPrefix = (params.ossPrefix ?? 'xhs').replace(/\/$/, '');
  const outputVar = params.outputVar ?? 'ossImageUrls';
  const downloadTimeout = params.downloadTimeout ?? 10000;
  const waitTime = params.waitTime ?? 3000;

  // 创建临时下载目录
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localhost-image-download-'));
  log.push(`📁 创建临时目录: ${tempDir}`);

  const downloadedFiles: string[] = [];
  const ossUrls: string[] = [];

  try {
    // 1. 导航到解析页面（如果不是当前页面）
    const currentUrl = page.url();
    if (!currentUrl.includes('localhost:1007/analysis/xhs')) {
      log.push(`🌐 导航到解析页面: ${pageUrl}`);
      try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        log.push(`✅ 导航成功`);
      } catch (navError) {
        log.push(`⚠️ 导航可能超时，但继续尝试: ${navError}`);
      }
    }

    // 2. 等待页面和图片加载（减少等待时间）
    try {
      await page.waitForTimeout(waitTime);
      log.push('⏳ 等待页面和图片加载完成');
    } catch (waitError) {
      log.push(`⚠️ 等待异常但继续: ${waitError}`);
    }

    // 3. 查找图片容器
    const imageContainers = page.locator(imageContainerSelector);
    const containerCount = await imageContainers.count();
    log.push(`🖼️ 找到 ${containerCount} 个图片容器`);

    if (containerCount === 0) {
      throw new Error(`未找到图片容器: ${imageContainerSelector}`);
    }

    // 4. 设置浏览器下载行为
    // 注意：Playwright 不直接支持 setDefaultDownloadDirectory
    // 我们需要在监听下载事件时处理文件保存路径

    // 5. 批量下载图片 - 使用简化的HTTP下载方式
    let downloadedCount = 0;
    
    for (let i = 0; i < Math.min(containerCount, maxImages); i++) {
      try {
        const container = imageContainers.nth(i);
        const images = container.locator(imageSelector);
        const imageCount = await images.count();
        
        if (imageCount === 0) continue;
        
        // 取第一张图片（通常是主图）
        const targetImage = images.first();
        
        // 滚动到图片位置
        await targetImage.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);

        // 获取图片URL
        const imageSrc = await targetImage.getAttribute('src') || '';
        const imageAlt = await targetImage.getAttribute('alt') || `image_${i}`;
        
        log.push(`📷 处理第 ${i + 1} 张图片: ${imageAlt}`);

        if (!imageSrc) {
          log.push(`⚠️ 第 ${i + 1} 张图片无src属性，跳过`);
          continue;
        }

        try {
          // 使用HTTP下载而不是右键保存
          log.push(`📥 开始下载: ${imageSrc.substring(0, 80)}...`);
          
          const response = await page.context().request.get(imageSrc, {
            timeout: downloadTimeout
          });
          
          if (!response.ok()) {
            throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
          }
          
          const imageBuffer = await response.body();
          const fileName = `image_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 6)}.jpg`;
          const downloadPath = path.join(tempDir, fileName);
          
          // 保存到临时文件
          await fs.writeFile(downloadPath, imageBuffer);
          
          // 验证文件
          const stats = await fs.stat(downloadPath);
          if (stats.size > 1000) { // 至少1KB
            downloadedFiles.push(downloadPath);
            downloadedCount++;
            log.push(`✅ 第 ${i + 1} 张图片下载成功: ${Math.round(stats.size / 1024)}KB`);
          } else {
            log.push(`⚠️ 第 ${i + 1} 张图片文件太小，跳过`);
          }

        } catch (downloadError) {
          log.push(`❌ 第 ${i + 1} 张图片下载失败: ${downloadError}`);
        }

        // 短暂延迟，避免过快操作
        await page.waitForTimeout(200);

      } catch (containerError) {
        log.push(`⚠️ 处理第 ${i + 1} 个容器失败: ${containerError}`);
      }
    }

    log.push(`📥 总共下载了 ${downloadedCount} 张图片`);

    // 6. 上传到OSS
    if (downloadedFiles.length > 0) {
      log.push('☁️ 开始上传到OSS...');
      
      for (let j = 0; j < downloadedFiles.length; j++) {
        try {
          const filePath = downloadedFiles[j];
          const fileName = path.basename(filePath);
          const ossKey = `${ossPrefix}/localhost-download/${Date.now()}_${fileName}`;
          
          const ossUrl = await uploadFromFile(filePath, ossKey, 'image/jpeg');
          ossUrls.push(ossUrl);
          log.push(`☁️ 第 ${j + 1} 张图片上传OSS成功: ${ossUrl}`);
          
        } catch (uploadError) {
          log.push(`❌ 第 ${j + 1} 张图片上传OSS失败: ${uploadError}`);
        }
      }
    }

    // 7. 设置输出变量
    ctx.outputs[outputVar] = ossUrls;

    // 8. 截图记录
    const screenshot = await captureScreenshot(page);

    return {
      success: true,
      log,
      output: {
        downloadedCount,
        uploadedCount: ossUrls.length,
        ossUrls,
        downloadedFiles: downloadedFiles.map(f => path.basename(f))
      },
      screenshot
    };

  } catch (error) {
    log.push(`❌ 批量下载失败: ${error}`);
    
    const screenshot = await captureScreenshot(page);
    
    return {
      success: false,
      log,
      error: String(error),
      screenshot
    };
    
  } finally {
    // 9. 清理临时文件
    try {
      if (downloadedFiles.length > 0) {
        for (const file of downloadedFiles) {
          await fs.unlink(file).catch(() => {});
        }
      }
      await fs.rmdir(tempDir).catch(() => {});
      log.push(`🗑️ 清理临时文件完成`);
    } catch (cleanupError) {
      log.push(`⚠️ 清理临时文件失败: ${cleanupError}`);
    }
  }
}