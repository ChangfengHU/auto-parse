import type { CDPSession, Page } from 'playwright';
import type { ClickParams, NodeResult } from '../types';
import { captureScreenshot } from '../utils';

/** Explicit exact-text targeting inside a single closed shadow host. Never guesses. */
export async function executeShadowButtonClick(page: Page, params: ClickParams): Promise<NodeResult> {
  const log: string[] = [];
  let cdp: CDPSession | undefined;
  try {
    const hostSelector = String(params.shadowHostSelector || '').trim();
    const text = String(params.text || '').trim();
    if (!hostSelector || !text || params.selector || params.elements?.length || params.useSelector || params.douyinPublication) throw new Error('shadow_button_requires_one_host_and_exact_text');
    const host = page.locator(hostSelector);
    await host.first().waitFor({ state: 'visible', timeout: params.timeout ?? 5000 });
    if (await host.count() !== 1) throw new Error('shadow_host_not_unique');
    await host.scrollIntoViewIfNeeded({ timeout: params.timeout ?? 5000 });
    cdp = await page.context().newCDPSession(page);
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: hostSelector });
    if (!nodeId) throw new Error('shadow_host_not_found');
    const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: 1, pierce: true });
    const roots = node.shadowRoots || [];
    if (roots.length !== 1) throw new Error('shadow_root_not_unique');
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: roots[0].backendNodeId });
    if (!object.objectId) throw new Error('shadow_root_unavailable');
    const target = await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function(text) {
        const buttons = [...this.querySelectorAll('button, [role="button"]')].filter(b => (b.innerText || b.textContent || '').trim() === text);
        if (buttons.length !== 1) return { error: 'shadow_button_not_unique' };
        const b = buttons[0], r = b.getBoundingClientRect(), s = getComputedStyle(b);
        if (b.disabled || b.getAttribute('aria-disabled') === 'true' || r.width < 2 || r.height < 2 || s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return { error: 'shadow_button_not_actionable' };
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return { error: 'shadow_button_outside_viewport' };
        const hit = this.elementFromPoint(x, y);
        if (!(hit === b || b.contains(hit)) || document.elementFromPoint(x, y) !== this.host) return { error: 'shadow_button_obscured' };
        return { x, y, text: b.innerText.trim() };
      }`,
      arguments: [{ value: text }], returnByValue: true,
    });
    const point = target.result.value;
    if (target.exceptionDetails || !point || point.error || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.text !== text) throw new Error(point?.error || 'shadow_button_not_verified');
    // A genuine browser input event, not a synthetic publish/save API invocation.
    await page.mouse.click(point.x, point.y);
    log.push(`✅ 封闭组件精确按钮点击：${hostSelector} / ${text}`);
    return { success: true, log, screenshot: await captureScreenshot(page) };
  } catch (error) {
    return { success: false, log, error: error instanceof Error ? error.message : String(error), screenshot: await captureScreenshot(page).catch(() => undefined) };
  } finally {
    await cdp?.detach().catch(() => undefined);
  }
}
