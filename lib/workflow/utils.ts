import type { Page } from 'playwright';

/** 截取当前页面截图，返回 base64 data URL */
export async function captureScreenshot(page: Page): Promise<string | undefined> {
  try {
    const buf = await page.screenshot({ fullPage: false });
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  }
}
