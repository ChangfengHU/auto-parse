import type { Page } from 'playwright';
import type { TextInputParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';

export async function executeTextInput(
  page: Page,
  params: TextInputParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];

  const requestedMode = (params as Partial<TextInputParams>).inputMode;
  const useHumanType = ctx.humanOptions?.humanType ?? false;
  // 默认：fill；但为兼容既有行为，如果未指定 inputMode 且开启 humanType，则按 type 执行
  const mode: 'fill' | 'type' = requestedMode === 'type' || requestedMode === 'fill'
    ? requestedMode
    : (useHumanType ? 'type' : 'fill');

  try {
    const value = String(params.value ?? '');

    const resolveTarget = async () => {
      const sel = String(params.selector || '').trim();
      if (sel) {
        const loc = page.locator(sel).first();
        const ok = await loc.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
        if (ok) {
          return { el: loc, selectorUsed: sel, fallback: false };
        }
        log.push(`⚠️ 未找到输入框：${sel}，尝试自动定位...`);
      }
      // Fallback：尽量自动找到“可输入框”（Gemini/各类 WebApp 的输入框经常是 contenteditable 或 shadow-dom）
      const loc = page.locator('textarea:visible, [contenteditable="true"]:visible, input[type="text"]:visible').last();
      await loc.waitFor({ state: 'visible', timeout: 10_000 });
      return { el: loc, selectorUsed: '(auto)', fallback: true };
    };

    const { el, selectorUsed, fallback } = await resolveTarget();
    log.push(`✏️ 填入文本到 ${selectorUsed}${fallback ? '（自动定位）' : ''}`);
    const isContentEditable = await el
      .evaluate((node) => node instanceof HTMLElement && node.isContentEditable)
      .catch(() => false);

    if (isContentEditable) {
      await el.click({ timeout: 10_000 });
      if (params.clear !== false) {
        await page.keyboard.press('ControlOrMeta+A').catch(() => {});
        await page.keyboard.press('Backspace').catch(() => {});
      }
    } else if (params.clear !== false) {
      await el.clear().catch(() =>
        el.selectText().then(() => page.keyboard.press('Backspace'))
      );
    }

    if (mode === 'type' && useHumanType) {
      // 逐字符输入，每个字符延迟随机波动（模拟真人打字节奏）
      const baseDelay = params.delay ?? 80;
      for (let i = 0; i < value.length; i++) {
        const char = value[i];
        if (isContentEditable) {
          await page.keyboard.type(char, { delay: 0 });
        } else {
          await el.pressSequentially(char, { delay: 0 });
        }
        // 随机延迟：基础 ± 40%，中文字符后偶尔多停顿
        const variance = baseDelay * 0.4;
        let delay = baseDelay + (Math.random() * 2 - 1) * variance;
        // 标点/空格后偶尔短暂停顿（像在想下一个词）
        if (/[，。！？\s]/.test(char) && Math.random() < 0.3) {
          delay += 200 + Math.random() * 400;
        }
        await page.waitForTimeout(delay);
      }
      log.push(`⌨️ type(human) 输入完成（${value.length} 字）`);
    } else if (mode === 'type') {
      const delay = params.delay && params.delay > 0 ? params.delay : 0;
      if (isContentEditable) {
        await page.keyboard.type(value, { delay });
      } else {
        await el.pressSequentially(value, { delay });
      }
      log.push(`⌨️ type 输入完成（${value.length} 字）`);
    } else {
      // fill
      if (isContentEditable) {
        // contentEditable 没有可靠的 fill，这里用 DOM 直写 + 触发 input/change
        await el.evaluate((node, nextValue) => {
          const el = node as HTMLElement;
          el.focus();
          el.textContent = String(nextValue ?? '');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, value);
      } else {
        await el.fill(value);
      }
      log.push(`🧾 fill 输入完成（${value.length} 字）`);
    }

    log.push(`✅ 已填入：${value.slice(0, 30)}${value.length > 30 ? '...' : ''}`);
    const screenshot = await captureScreenshot(page);
    return { success: true, log, screenshot };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.push(`❌ 填入失败: ${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  }
}
