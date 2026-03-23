/**
 * Cookie 提取执行器
 * 
 * 支持: extractCookie
 */

import { Page } from 'playwright';
import { ActionParams, ExecutionContext, StepExecutor } from '../types';

export class ExtractCookieExecutor implements StepExecutor {
  async execute(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const domain = params.domain ? context.resolve(params.domain) : null;
    const cookieNames = params.cookieNames;
    const variableName = params.variableName ?? 'cookieStr';

    context.log(`提取 Cookie${domain ? ` (domain: ${domain})` : ''}`);

    // 获取所有 Cookie
    const browserContext = page.context();
    const allCookies = await browserContext.cookies();

    // 过滤
    let cookies = allCookies;

    if (domain) {
      cookies = cookies.filter(c => c.domain.includes(domain));
    }

    if (cookieNames && cookieNames.length > 0) {
      cookies = cookies.filter(c => cookieNames.includes(c.name));
    }

    if (cookies.length === 0) {
      context.log('未找到 Cookie');
      return;
    }

    // 转换为字符串
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // 保存到变量
    context.variables.set(variableName, cookieStr);
    context.log(`已提取 ${cookies.length} 个 Cookie → $\{${variableName}}`);

    // 同时保存关键 Cookie 到单独变量（便于后续使用）
    const keyNames = ['sessionid', 'uid_tt', 'ttwid', 'passport_csrf_token'];
    for (const name of keyNames) {
      const cookie = cookies.find(c => c.name === name);
      if (cookie) {
        context.variables.set(`cookie_${name}`, cookie.value);
      }
    }
  }
}
