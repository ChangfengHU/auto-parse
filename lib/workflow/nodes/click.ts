import type { Locator, Page } from 'playwright';
import type { ClickParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import { humanMouseMove } from '../human-mouse';

function isLikelySendActionTarget(input: { selector?: string; text?: string }) {
  const text = String(input.text || '').toLowerCase();
  const selector = String(input.selector || '').toLowerCase();
  return (
    text.includes('submit') ||
    text.includes('提交') ||
    text.includes('send') ||
    text.includes('发送') ||
    selector.includes('submit') ||
    selector.includes('aria-label="submit"') ||
    selector.includes('send message') ||
    selector.includes('send-button') ||
    selector.includes('aria-label="send message"') ||
    selector.includes('aria-label*="发送"')
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 单条候选对应的 Locator；配置不完整则返回 null（多候选时跳过该条） */
function locatorForClickTarget(
  page: Page,
  target: { text?: string; selector?: string; useSelector?: boolean }
): Locator | null {
  const useSelector = target.useSelector || (!target.text && !!target.selector);
  if (useSelector) {
    const sel = String(target.selector ?? '').trim();
    if (!sel) return null;
    return page.locator(sel);
  }
  const label = String(target.text ?? '').trim();
  if (!label) return null;
  const pattern = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return page
    .getByRole('button', { name: pattern })
    .or(page.getByRole('link', { name: pattern }))
    .or(page.getByText(label, { exact: false }));
}

function describeClickTarget(target: { text?: string; selector?: string; useSelector?: boolean }): string {
  const useSelector = target.useSelector || (!target.text && !!target.selector);
  if (useSelector) return `selector=${String(target.selector ?? '').slice(0, 80)}`;
  return `text=${String(target.text ?? '')}`;
}

async function pickPreferredLocator(locator: Locator, nth: number | undefined, log: string[], prefix: string) {
  const count = await locator.count().catch(() => 0);
  if (count <= 0) return locator.last();

  if (nth !== undefined) {
    const index = nth >= 0 ? nth : Math.max(0, count + nth);
    return locator.nth(Math.min(index, Math.max(0, count - 1)));
  }

  for (let idx = count - 1; idx >= 0; idx--) {
    const candidate = locator.nth(idx);
    const visible = await candidate.isVisible().catch(() => false);
    if (visible) {
      if (idx !== count - 1) {
        log.push(`${prefix}ℹ️ 已避开末尾隐藏元素，改用可见候选 #${idx + 1}/${count}`);
      }
      return candidate;
    }
  }

  return locator.last();
}

async function tryRevealSendButton(page: Page, log: string[], prefix: string) {
  const inputSelector =
    'rich-textarea .ql-editor[contenteditable="true"], div.ql-editor[contenteditable="true"], textarea:visible, [contenteditable="true"]:visible';
  try {
    const input = page.locator(inputSelector).last();
    await input.hover({ timeout: 1_200 });
    await page.waitForTimeout(120);
    log.push(`${prefix}🪄 已尝试通过悬停输入框激活发送按钮`);
  } catch {
    // ignore
  }
}

async function trySendSelectorFallback(page: Page, timeout: number, log: string[], prefix: string) {
  const selectors = [
    'button[aria-label="Submit"]',
    'button[aria-label*="Submit" i]',
    'button[aria-label="Send message"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="发送"]',
    '.send-button-container button',
  ];

  for (const selector of selectors) {
    try {
      const btn = page.locator(selector).last();
      await btn.waitFor({ state: 'visible', timeout: Math.min(1_500, timeout) });
      await btn.click({ timeout, force: true });
      log.push(`${prefix}🛟 发送按钮候选点击成功：${selector}`);
      return true;
    } catch {
      // try next
    }
  }

  try {
    const btn = page.getByRole('button', { name: /submit|send|发送|提交/i }).last();
    await btn.waitFor({ state: 'visible', timeout: Math.min(1_500, timeout) });
    await btn.click({ timeout, force: true });
    log.push(`${prefix}🛟 发送按钮 role 兜底点击成功`);
    return true;
  } catch {
    return false;
  }
}

async function readSendMarkers(page: Page) {
  const sendVisible = await page
    .locator('button[aria-label="Submit"], button[aria-label*="Submit" i], button[aria-label="Send message"], button[aria-label*="Send" i], button[aria-label*="发送"], .send-button-container button')
    .last()
    .isVisible()
    .catch(() => false);
  const stopVisible = await page
    .locator('button[aria-label*="Stop" i], button[aria-label*="停止"]')
    .first()
    .isVisible()
    .catch(() => false);
  return { sendVisible, stopVisible };
}

async function tryInputCornerClickFallback(page: Page, log: string[], prefix: string) {
  const inputSelector =
    'rich-textarea .ql-editor[contenteditable="true"], div.ql-editor[contenteditable="true"], textarea:visible, [contenteditable="true"]:visible';
  try {
    const input = page.locator(inputSelector).last();
    await input.waitFor({ state: 'visible', timeout: 1_500 });
    const box = await input.boundingBox();
    if (!box) return false;
    const before = await readSendMarkers(page);
    const cx = Math.max(0, Math.round(box.x + box.width - 20));
    const cy = Math.max(0, Math.round(box.y + box.height - 20));
    await page.mouse.move(cx, cy);
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(220);
    const after = await readSendMarkers(page);
    if ((!before.stopVisible && after.stopVisible) || (before.sendVisible && !after.sendVisible)) {
      log.push(`${prefix}🛟 输入框右下角坐标点击发送成功 (${cx}, ${cy})`);
      return true;
    }

    const domClick = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!el) return false;
      const btn = el.closest('button,[role="button"]') as HTMLElement | null;
      if (btn) {
        btn.click();
        return true;
      }
      if (typeof el.click === 'function') {
        el.click();
        return true;
      }
      return false;
    }, [cx, cy] as const).catch(() => false);
    if (!domClick) return false;
    await page.waitForTimeout(220);
    const afterDom = await readSendMarkers(page);
    if ((!before.stopVisible && afterDom.stopVisible) || (before.sendVisible && !afterDom.sendVisible)) {
      log.push(`${prefix}🛟 elementFromPoint 发送兜底成功`);
      return true;
    }
  } catch {
    // continue
  }
  return false;
}

async function tryDirectClickFallback(locator: Locator, log: string[], prefix: string) {
  try {
    const fallback = locator.last();
    await fallback.scrollIntoViewIfNeeded().catch(() => {});
    await fallback.click({ timeout: 2_000, force: true });
    log.push(`${prefix}🛟 force click 兜底成功`);
    return true;
  } catch {
    // continue
  }

  try {
    const fallback = locator.last();
    const handle = await fallback.elementHandle();
    if (!handle) return false;
    await handle.evaluate((el) => {
      (el as HTMLElement).click();
    });
    log.push(`${prefix}🛟 JS click 兜底成功`);
    return true;
  } catch {
    return false;
  }
}

async function trySendHotkeyFallback(page: Page, log: string[], prefix: string) {
  const inputSelector =
    'rich-textarea .ql-editor[contenteditable="true"], div.ql-editor[contenteditable="true"], textarea:visible, [contenteditable="true"]:visible';
  await page.locator(inputSelector).last().click({ timeout: 1_500 }).catch(() => {});

  const candidates = [
    'Enter',
    process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter',
  ];

  for (const hotkey of candidates) {
    try {
      await page.keyboard.press(hotkey);
      await page.waitForTimeout(250);
      log.push(`${prefix}🛟 发送热键兜底成功：${hotkey}`);
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

export async function executeClick(
  page: Page,
  params: ClickParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  const useHumanMouse = ctx.humanOptions?.humanMouse ?? false;

  // 针对 Gemini 等重前端页面，给一定的沉降时间让元素稳定渲染
  await sleep(300);

  const targets = params.elements && params.elements.length > 0
    ? params.elements
    : [{ text: params.text, selector: params.selector, useSelector: params.useSelector }];

  const isMulti = targets.length > 1;
  const prefix = isMulti ? '[多候选] ' : '';

  const mergedParts: Locator[] = [];
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const loc = locatorForClickTarget(page, target);
    if (loc) {
      mergedParts.push(loc);
      if (isMulti) {
        log.push(`[候选 ${i + 1}] 并入并集：${describeClickTarget(target)}`);
      } else {
        const useSelector = target.useSelector || (!target.text && !!target.selector);
        log.push(
          useSelector
            ? `${prefix}尝试点击元素：${target.selector}`
            : `${prefix}尝试点击按钮文字：${target.text}`
        );
      }
    } else if (isMulti) {
      log.push(`[候选 ${i + 1}] 跳过：缺少有效的 text 或 selector`);
    }
  }

  if (mergedParts.length === 0) {
    const err =
      !isMulti
        ? (() => {
            const t = targets[0];
            const useSel = t.useSelector || (!t.text && !!t.selector);
            if (useSel && !String(t.selector ?? '').trim()) return '选择器模式下缺少 selector';
            return '文字模式下缺少 text';
          })()
        : '所有候选均无效（缺少 text/selector）';
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error: err, screenshot };
  }

  let locator: Locator = mergedParts.reduce((acc, part) => acc.or(part));
  if (isMulti) {
    log.push(
      `${prefix}🔗 ${mergedParts.length} 条有效候选已用 locator.or() 合并，共享同一次可见等待与点击超时（避免串行累加）`
    );
  }

  const likelySendAction = targets.some((t) =>
    isLikelySendActionTarget({ selector: t.selector, text: t.text })
  );

  let finalSuccess = false;
  let lastError = '';

  try {
    locator = await pickPreferredLocator(locator, params.nth, log, prefix);

    if (likelySendAction) {
      await tryRevealSendButton(page, log, prefix);
    }

    if (params.waitFor !== false) {
      await locator.waitFor({ state: 'visible', timeout: params.timeout ?? 5_000 });
    }

    if (useHumanMouse) {
      const box = await locator.boundingBox().catch(() => null);
      if (box) {
        const cx = Math.round(box.x + box.width / 2);
        const cy = Math.round(box.y + box.height / 2);
        await humanMouseMove(page, cx, cy);
        await page.waitForTimeout(80 + Math.random() * 120);
        await page.mouse.click(cx, cy);
        log.push(`${prefix}🐭 人工鼠标点击成功 (${cx}, ${cy})`);
      } else {
        await locator.click({ timeout: params.timeout ?? 5_000 });
      }
    } else {
      await locator.click({ timeout: params.timeout ?? 5_000 });
    }

    log.push(`${prefix}✅ 点击成功`);
    finalSuccess = true;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    log.push(`${prefix}❌ 尝试失败: ${lastError}`);

    if (locator) {
      const directFallbackOk = await tryDirectClickFallback(locator, log, prefix);
      if (directFallbackOk) {
        finalSuccess = true;
      }
    }

    if (!finalSuccess && likelySendAction) {
      const cornerFallbackOk = await tryInputCornerClickFallback(page, log, prefix);
      if (cornerFallbackOk) {
        finalSuccess = true;
      } else {
        const selectorFallbackOk = await trySendSelectorFallback(page, params.timeout ?? 5_000, log, prefix);
        if (selectorFallbackOk) {
          finalSuccess = true;
        } else {
          const hotkeyFallbackOk = await trySendHotkeyFallback(page, log, prefix);
          if (hotkeyFallbackOk) {
            finalSuccess = true;
          }
        }
      }
    }
  }

  const screenshot = await captureScreenshot(page).catch(() => undefined);
  if (finalSuccess) {
    await page.waitForTimeout(1000);
    return { success: true, log, screenshot };
  } else {
    return { success: false, log, error: lastError || '所有候选目标均点击失败', screenshot };
  }
}
