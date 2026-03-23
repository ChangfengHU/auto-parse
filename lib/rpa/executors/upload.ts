/**
 * 上传执行器
 * 
 * 支持: upload
 */

import { Page } from 'playwright';
import { ActionParams, ExecutionContext, StepExecutor } from '../types';
import { SelectorResolver } from '../selector-resolver';

export class UploadExecutor implements StepExecutor {
  async execute(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    if (!params.selector) {
      throw new Error('上传操作缺少 selector 参数');
    }

    const filePath = params.filePath ?? params.value;
    const filePaths = params.filePaths;

    if (!filePath && (!filePaths || filePaths.length === 0)) {
      throw new Error('上传操作缺少 filePath 参数');
    }

    const resolver = new SelectorResolver(page);
    const selectors = Array.isArray(params.selector) 
      ? params.selector.map(s => context.resolve(s))
      : [context.resolve(params.selector)];

    const selector = await resolver.resolve(selectors, params.timeout);
    
    if (!selector) {
      throw new Error(`未找到上传元素: ${JSON.stringify(params.selector)}`);
    }

    const locator = page.locator(selector).first();

    // 处理文件路径
    let files: string | string[];
    
    if (filePaths && filePaths.length > 0) {
      files = filePaths.map(p => context.resolve(p));
      context.log(`上传 ${files.length} 个文件`);
    } else {
      files = context.resolve(filePath!);
      context.log(`上传文件: ${files}`);
    }

    // 设置文件
    await locator.setInputFiles(files, { timeout: params.timeout ?? 60000 });
  }
}
