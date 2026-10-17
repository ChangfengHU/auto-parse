import type { Page } from 'playwright';
import type { ClickParams, NodeResult } from '../types';

/** Explicit optional UI hints: missing/hidden is a skip, not a minute of click fallbacks. */
export async function optionalClickPreflight(page: Page, params: ClickParams): Promise<NodeResult | undefined> {
  if (!params.skipIfMissing) return;
  if (!params.selector || params.text || params.elements?.length || params.shadowHostSelector || params.douyinPublication || params.xhsPublication) {
    return { success: false, log: [], error: 'optional_click_requires_one_selector' };
  }
  try {
    const target = page.locator(params.selector);
    await target.first().waitFor({state:'visible',timeout:Math.min(params.timeout ?? 1500,5000)});
    if (await target.count() !== 1) return {success:false,log:[],error:'optional_click_target_ambiguous'};
  } catch(error) {
    if (error instanceof Error && error.name === 'TimeoutError') return {success:true,stepSkipped:true,log:['⏭️ 可选控件不存在或不可见，跳过点击']};
    return {success:false,log:[],error:'optional_click_inspection_failed'};
  }
}
