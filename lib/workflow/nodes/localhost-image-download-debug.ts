/**
 * localhost-image-download-debug 节点 — 调试版本
 */

import type { Page } from 'playwright';
import type { NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';

export interface LocalhostImageDownloadDebugParams {
  pageUrl?: string;
  imageContainerSelector?: string;
  imageSelector?: string;
  maxImages?: number;
  outputVar?: string;
}

export async function executeLocalhostImageDownloadDebug(
  page: Page,
  params: LocalhostImageDownloadDebugParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];

  try {
    // 解析参数
    const pageUrl = params.pageUrl || 'http://localhost:1007/analysis/xhs';
    const imageContainerSelector = params.imageContainerSelector || 'div.rounded-lg.overflow-hidden.border';
    const imageSelector = params.imageSelector || 'img';
    const maxImages = params.maxImages ?? 10;
    const outputVar = params.outputVar ?? 'debugImageUrls';

    log.push(`🔧 开始调试，参数: 容器=${imageContainerSelector}, 图片=${imageSelector}`);

    // 1. 检查当前页面URL
    const currentUrl = page.url();
    log.push(`📍 当前页面URL: ${currentUrl}`);

    // 2. 如果需要导航
    if (!currentUrl.includes('localhost:1007/analysis/xhs')) {
      log.push(`🌐 需要导航到: ${pageUrl}`);
      try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        log.push(`✅ 导航成功`);
      } catch (navError) {
        log.push(`❌ 导航失败: ${navError}`);
        throw navError;
      }
    } else {
      log.push(`✅ 已在目标页面，无需导航`);
    }

    // 3. 等待页面稳定（较短时间）
    try {
      await page.waitForTimeout(2000);
      log.push(`⏳ 页面等待完成`);
    } catch (waitError) {
      log.push(`⚠️ 页面等待异常: ${waitError}`);
    }

    // 4. 查找图片容器
    log.push(`🔍 查找图片容器: ${imageContainerSelector}`);
    const imageContainers = page.locator(imageContainerSelector);
    
    let containerCount = 0;
    try {
      containerCount = await imageContainers.count();
      log.push(`🖼️ 找到 ${containerCount} 个图片容器`);
    } catch (countError) {
      log.push(`❌ 统计容器数量失败: ${countError}`);
    }

    if (containerCount === 0) {
      // 尝试其他选择器
      log.push(`🔍 尝试其他选择器...`);
      
      const altSelectors = [
        'div[class*="rounded"]',
        'div[class*="border"]',
        'div:has(img)',
        '[class*="image"]'
      ];

      for (const selector of altSelectors) {
        try {
          const altContainers = page.locator(selector);
          const altCount = await altContainers.count();
          log.push(`🔍 选择器 "${selector}": ${altCount} 个元素`);
          
          if (altCount > 0) {
            // 检查这些元素是否包含图片
            const hasImages = await altContainers.first().locator('img').count();
            log.push(`  └─ 包含图片: ${hasImages} 张`);
          }
        } catch (e) {
          log.push(`  └─ 选择器 "${selector}" 查询失败: ${e}`);
        }
      }
    }

    // 5. 查找所有图片
    log.push(`🔍 直接查找所有图片元素`);
    const allImages = page.locator('img');
    const totalImages = await allImages.count();
    log.push(`🖼️ 页面总共有 ${totalImages} 张图片`);

    // 6. 检查小红书图片
    const xhsImages = page.locator('img[src*="xhscdn"]');
    const xhsImageCount = await xhsImages.count();
    log.push(`📕 小红书图片: ${xhsImageCount} 张`);

    // 7. 获取前几张图片的信息
    const imageUrls: string[] = [];
    const maxCheck = Math.min(totalImages, 5);
    
    for (let i = 0; i < maxCheck; i++) {
      try {
        const img = allImages.nth(i);
        const src = await img.getAttribute('src');
        const alt = await img.getAttribute('alt') || '无描述';
        log.push(`  图片${i + 1}: ${alt} - ${src?.substring(0, 80)}...`);
        
        if (src) {
          imageUrls.push(src);
        }
      } catch (imgError) {
        log.push(`  图片${i + 1}: 获取信息失败 - ${imgError}`);
      }
    }

    // 8. 设置输出
    ctx.outputs[outputVar] = imageUrls.slice(0, maxImages);

    const screenshot = await captureScreenshot(page);

    return {
      success: true,
      log,
      output: {
        containerCount,
        totalImages,
        xhsImageCount,
        imageUrls: imageUrls.slice(0, maxImages),
        debugInfo: {
          currentUrl: page.url(),
          pageTitle: await page.title().catch(() => 'unknown')
        }
      },
      screenshot
    };

  } catch (error) {
    log.push(`❌ 调试失败: ${error}`);
    
    const screenshot = await captureScreenshot(page);
    
    return {
      success: false,
      log,
      error: String(error),
      screenshot
    };
  }
}