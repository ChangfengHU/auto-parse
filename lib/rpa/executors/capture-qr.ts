/**
 * 二维码截取执行器
 * 
 * 支持: captureQR
 */

import { Page } from 'playwright';
import { ActionParams, ExecutionContext, StepExecutor } from '../types';
import { SelectorResolver } from '../selector-resolver';

export class CaptureQRExecutor implements StepExecutor {
  async execute(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const resolver = new SelectorResolver(page);
    
    // 默认二维码选择器
    const defaultSelectors = [
      '[class*="qrcode_img"]',
      '[class*="qrcode-img"]',
      '[class*="qr-code"]',
      'canvas[class*="qr"]',
      '[class*="scan_qrcode"] img',
      '[class*="login"] img[src*="qrcode"]',
      'img[src*="qrcode"]',
      'img[src*="qr"]',
    ];

    const selectors = params.selector 
      ? (Array.isArray(params.selector) 
          ? params.selector.map(s => context.resolve(s))
          : [context.resolve(params.selector)])
      : defaultSelectors;

    context.log('正在截取二维码...');

    // 尝试找到二维码元素
    const selector = await resolver.resolve(selectors, params.timeout ?? 10000);
    
    let screenshotBuffer: Buffer | null = null;

    if (selector) {
      // 找到二维码元素，截取元素截图
      try {
        const locator = page.locator(selector).first();
        screenshotBuffer = await locator.screenshot({ timeout: 5000 });
        context.log(`二维码元素截取成功: ${selector}`);
      } catch (e) {
        context.log(`元素截图失败，尝试全页截图: ${e}`);
      }
    }

    // 如果元素截图失败，使用全页截图
    if (!screenshotBuffer) {
      try {
        screenshotBuffer = await page.screenshot({ fullPage: false, timeout: 5000 });
        context.log('使用全页截图作为二维码');
      } catch (e) {
        throw new Error(`截取二维码失败: ${e}`);
      }
    }

    // 发送二维码图片
    if (screenshotBuffer) {
      const base64 = screenshotBuffer.toString('base64');
      context.emit('qrcode', `data:image/png;base64,${base64}`);
    }

    // 如果指定了变量名，保存截图路径
    if (params.variableName) {
      context.variables.set(params.variableName, `data:image/png;base64,${screenshotBuffer?.toString('base64') ?? ''}`);
    }
  }
}
