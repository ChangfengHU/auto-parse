import type { Page } from 'playwright';
import type { NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';

export async function executeScreenshot(
  page: Page,
  _params: Record<string, unknown>,
  _ctx: WorkflowContext
): Promise<NodeResult> {
  const screenshot = await captureScreenshot(page);
  return { success: true, log: ['📸 截图完成'], screenshot };
}
