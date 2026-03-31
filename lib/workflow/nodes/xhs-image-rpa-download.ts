/**
 * xhs-image-rpa-download 节点 — 小红书图片RPA下载
 *
 * 使用浏览器自动化右键保存图片，绕过防盗链限制
 * 
 * 流程：
 *  1. 在小红书页面上定位图片元素
 *  2. 右键点击图片
 *  3. 选择"图片存储为"或"Save image as"
 *  4. 保存到临时目录
 *  5. 上传到OSS
 *  6. 清理临时文件
 */

import type { Page } from 'playwright';
import type { NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import { uploadFromFile } from '../../oss';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface XhsImageRpaDownloadParams {
  /** 图片选择器，用于定位要下载的图片 */
  imageSelector?: string;
  /** 图片索引（如果页面有多张图片） */
  imageIndex?: number;
  /** OSS上传路径前缀 */
  ossPrefix?: string;
  /** 输出变量名，存储上传后的OSS URL */
  outputVar?: string;
  /** 下载超时时间（毫秒） */
  downloadTimeout?: number;
}

export async function executeXhsImageRpaDownload(
  page: Page,
  params: XhsImageRpaDownloadParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];

  // 解析参数
  const imageSelector = params.imageSelector || 'img[src*="xhscdn.com"]';
  const imageIndex = params.imageIndex ?? 0;
  const ossPrefix = (params.ossPrefix ?? 'xhs').replace(/\/$/, '');
  const outputVar = params.outputVar ?? 'ossImageUrl';
  const downloadTimeout = params.downloadTimeout ?? 30000;

  // 创建临时下载目录
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xhs-rpa-download-'));
  log.push(`📁 创建临时目录: ${tempDir}`);

  try {
    // 1. 等待页面加载
    await page.waitForLoadState('networkidle');
    log.push('⏳ 等待页面加载完成');

    // 2. 查找图片元素
    const images = await page.locator(imageSelector);
    const imageCount = await images.count();
    
    if (imageCount === 0) {
      throw new Error(`未找到图片元素: ${imageSelector}`);
    }

    if (imageIndex >= imageCount) {
      throw new Error(`图片索引 ${imageIndex} 超出范围，共有 ${imageCount} 张图片`);
    }

    const targetImage = images.nth(imageIndex);
    log.push(`🖼️ 找到 ${imageCount} 张图片，选择第 ${imageIndex + 1} 张`);

    // 3. 获取图片信息
    const imageSrc = await targetImage.getAttribute('src');
    log.push(`📷 图片源地址: ${imageSrc}`);

    // 4. 滚动到图片位置并确保可见
    await targetImage.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    // 5. 设置下载路径
    const downloadFileName = `image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
    const downloadPath = path.join(tempDir, downloadFileName);

    // 6. 监听下载事件
    const downloadPromise = page.waitForEvent('download', { timeout: downloadTimeout });

    // 7. 右键点击图片
    await targetImage.click({ button: 'right' });
    log.push('🖱️ 右键点击图片');

    // 8. 等待右键菜单出现并点击保存选项
    try {
      // 尝试不同的保存选项文本
      const saveOptions = [
        'text="图片存储为"',
        'text="Save image as"', 
        'text="另存为"',
        'text="Save as"',
        'text=/.*存储.*/',
        'text=/.*save.*image.*/i'
      ];

      let saveClicked = false;
      for (const option of saveOptions) {
        try {
          const saveButton = page.locator(option);
          if (await saveButton.isVisible({ timeout: 1000 })) {
            await saveButton.click();
            log.push(`💾 点击保存选项: ${option}`);
            saveClicked = true;
            break;
          }
        } catch (e) {
          // 继续尝试下一个选项
        }
      }

      if (!saveClicked) {
        // 如果找不到保存选项，尝试使用键盘快捷键
        await page.keyboard.press('Escape'); // 先关闭右键菜单
        await page.waitForTimeout(500);
        
        // 重新右键点击
        await targetImage.click({ button: 'right' });
        await page.waitForTimeout(500);
        
        // 使用键盘导航（通常保存图片是第一个或第二个选项）
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        log.push('⌨️ 使用键盘快捷键保存图片');
      }

    } catch (contextMenuError) {
      log.push(`⚠️ 右键菜单操作失败: ${contextMenuError}`);
      
      // 备用方案：尝试使用Ctrl+S或Cmd+S
      await page.keyboard.press('Escape');
      await targetImage.focus();
      
      const isMac = process.platform === 'darwin';
      const saveKey = isMac ? 'Meta+s' : 'Ctrl+s';
      await page.keyboard.press(saveKey);
      log.push(`💾 使用快捷键保存: ${saveKey}`);
    }

    // 9. 等待下载完成
    const download = await downloadPromise;
    await download.saveAs(downloadPath);
    log.push(`📥 图片下载完成: ${downloadPath}`);

    // 10. 验证文件是否存在且有内容
    const stats = await fs.stat(downloadPath);
    if (stats.size === 0) {
      throw new Error('下载的文件为空');
    }
    log.push(`📊 文件大小: ${Math.round(stats.size / 1024)}KB`);

    // 11. 上传到OSS
    const ossKey = `${ossPrefix}/rpa-downloaded/${Date.now()}_${downloadFileName}`;
    const ossUrl = await uploadFromFile(downloadPath, ossKey, 'image/jpeg');
    log.push(`☁️ 上传OSS成功: ${ossUrl}`);

    // 12. 设置输出变量
    ctx.outputs[outputVar] = ossUrl;

    // 13. 截图记录
    const screenshot = await captureScreenshot(page);

    return {
      success: true,
      log,
      output: {
        originalUrl: imageSrc,
        downloadPath,
        ossUrl,
        fileSize: stats.size
      },
      screenshot
    };

  } catch (error) {
    log.push(`❌ RPA下载失败: ${error}`);
    
    const screenshot = await captureScreenshot(page);
    
    return {
      success: false,
      log,
      error: String(error),
      screenshot
    };
    
  } finally {
    // 14. 清理临时目录
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      log.push(`🗑️ 清理临时目录: ${tempDir}`);
    } catch (cleanupError) {
      log.push(`⚠️ 清理临时目录失败: ${cleanupError}`);
    }
  }
}