/**
 * 等待登录执行器
 * 
 * 支持: waitForLogin
 */

import { Page } from 'playwright';
import { ActionParams, ExecutionContext, StepExecutor } from '../types';

export class WaitForLoginExecutor implements StepExecutor {
  async execute(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const timeout = params.timeout ?? 300000; // 默认 5 分钟
    const urlPattern = params.urlPattern ? context.resolve(params.urlPattern) : null;
    const excludePatterns = params.excludePatterns ?? [];

    context.log('等待扫码登录...');

    // 等待 URL 变化到登录成功页面
    await page.waitForURL(
      url => {
        const urlStr = url.toString();

        // 检查排除模式
        for (const pattern of excludePatterns) {
          if (urlStr.includes(pattern)) {
            return false;
          }
        }

        // 检查是否匹配成功页面
        if (urlPattern) {
          // 支持通配符
          const patternStr = urlPattern.replace(/\*/g, '');
          return urlStr.includes(patternStr);
        }

        // 默认：不在登录页面就认为登录成功
        return !urlStr.includes('/login') && 
               !urlStr.includes('passport') && 
               !urlStr.includes('qrcode');
      },
      { timeout }
    );

    context.log('扫码登录成功！');
    context.emit('log', '✅ 扫码登录成功！');

    // 等待页面稳定
    await page.waitForTimeout(2000);
  }
}
