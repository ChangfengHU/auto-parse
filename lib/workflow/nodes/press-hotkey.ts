import type { Page } from 'playwright';
import type { NodeResult, PressHotkeyParams, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';

export async function executePressHotkey(
  page: Page,
  params: PressHotkeyParams,
  _ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];

  const snapshot = async (targetSelector?: string) => {
    const res = await page.evaluate((sel) => {
      const ae = document.activeElement as any;
      const tag = ae?.tagName ? String(ae.tagName).toLowerCase() : '';
      const isCE = Boolean(ae?.isContentEditable);
      const value = typeof ae?.value === 'string' ? ae.value : '';
      const hasSelectionRange = typeof ae?.selectionStart === 'number' && typeof ae?.selectionEnd === 'number';
      const selectionStart = hasSelectionRange ? ae.selectionStart : null;
      const selectionEnd = hasSelectionRange ? ae.selectionEnd : null;
      const winSel = window.getSelection();
      const selectionText = winSel ? String(winSel.toString() || '') : '';

      let targetTag = '';
      let targetIsCE = false;
      let targetTextLen = 0;
      if (sel) {
        const el = document.querySelector(sel) as any;
        if (el) {
          targetTag = el.tagName ? String(el.tagName).toLowerCase() : '';
          targetIsCE = Boolean(el.isContentEditable);
          const text = targetIsCE ? String(el.innerText || '') : (typeof el.value === 'string' ? el.value : '');
          targetTextLen = text.length;
        }
      }

      return {
        active: { tag, isCE, valueLen: value.length, selectionStart, selectionEnd },
        windowSelectionLen: selectionText.length,
        target: sel ? { selector: sel, tag: targetTag, isCE: targetIsCE, textLen: targetTextLen } : null,
      };
    }, targetSelector || '');
    return res as any;
  };

  const selectionEffective = (snap: any) => {
    const a = snap?.active;
    const winLen = Number(snap?.windowSelectionLen || 0);
    const hasRange = typeof a?.selectionStart === 'number' && typeof a?.selectionEnd === 'number';
    if (hasRange) return (a.selectionEnd - a.selectionStart) > 0;
    return winLen > 0;
  };

  const expandHotkeys = (hotkey: string): string[] => {
    const hk = hotkey.trim();
    if (!hk) return [];
    if (hk.includes('ControlOrMeta')) {
      return [hk.replace('ControlOrMeta', 'Meta'), hk.replace('ControlOrMeta', 'Control')];
    }
    if (hk.includes('Meta') && !hk.includes('Control')) return [hk, hk.replace('Meta', 'Control')];
    if (hk.includes('Control') && !hk.includes('Meta')) return [hk, hk.replace('Control', 'Meta')];
    return [hk];
  };

  try {
    const hotkeyRaw = String(params.hotkey || '').trim();
    if (!hotkeyRaw) throw new Error('hotkey 不能为空');

    const targetSelector = String(params.targetSelector || '').trim();
    const clickToFocus = params.clickToFocus ?? true;
    const ensurePageFocused = params.ensurePageFocused ?? true;
    const waitBefore = Math.max(0, Number(params.waitBefore ?? 0) || 0);
    const waitAfter = Math.max(0, Number(params.waitAfter ?? 200) || 200);
    const repeat = Math.max(1, Math.floor(Number(params.repeat ?? 1) || 1));
    const verifySelection = params.verifySelection ?? true;
    const fallbackOnNoEffect = params.fallbackOnNoEffect ?? true;
    const domSelectAllFallback = params.domSelectAllFallback ?? true;

    if (ensurePageFocused) {
      await page.bringToFront().catch(() => {});
      await page.evaluate(() => window.focus()).catch(() => {});
      log.push('🧲 已尝试 bringToFront + window.focus');
    }

    if (targetSelector) {
      const target = page.locator(targetSelector).first();
      await target.waitFor({ state: 'visible', timeout: 15_000 });
      if (clickToFocus) {
        await target.click({ timeout: 10_000 });
      } else {
        await target.focus();
      }
      log.push(`🎯 已聚焦目标：${targetSelector}`);
    } else {
      log.push('🎯 未指定 targetSelector：将在当前焦点执行快捷键');
    }

    if (waitBefore > 0) {
      await page.waitForTimeout(waitBefore);
    }

    const before = await snapshot(targetSelector);
    log.push(`🔎 before: active=${before.active.tag}(ce=${before.active.isCE}) selLen=${before.windowSelectionLen} targetTextLen=${before.target?.textLen ?? '-'} `);

    const candidates = fallbackOnNoEffect ? Array.from(new Set(expandHotkeys(hotkeyRaw))) : [hotkeyRaw];

    let usedHotkey = '';
    let ok = false;

    for (const hk of candidates) {
      usedHotkey = hk;
      for (let i = 0; i < repeat; i++) {
        log.push(`⌨️ 执行快捷键：${hk}（${i + 1}/${repeat}）`);
        await page.keyboard.press(hk);
        if (waitAfter > 0) await page.waitForTimeout(waitAfter);
      }

      if (!verifySelection) {
        ok = true;
        break;
      }

      const after = await snapshot(targetSelector);
      const effective = selectionEffective(after);
      log.push(`🔎 after: active=${after.active.tag}(ce=${after.active.isCE}) selLen=${after.windowSelectionLen} effective=${effective}`);

      if (effective) {
        ok = true;
        break;
      }

      // 对于全选（A）再给一次 DOM 兜底，便于验证“元素可被选中”
      if (domSelectAllFallback && /\+A$/i.test(hk) && targetSelector) {
        const domOk = await page.evaluate((sel) => {
          const el = document.querySelector(sel) as any;
          if (!el) return false;
          // input/textarea
          if (typeof el.select === 'function') {
            el.select();
            return true;
          }
          // contenteditable
          if (el.isContentEditable) {
            const range = document.createRange();
            range.selectNodeContents(el);
            const s = window.getSelection();
            if (!s) return false;
            s.removeAllRanges();
            s.addRange(range);
            return true;
          }
          return false;
        }, targetSelector).catch(() => false);

        const afterDom = await snapshot(targetSelector);
        const effectiveDom = selectionEffective(afterDom);
        log.push(`🧪 DOM 全选兜底：ran=${domOk} effective=${effectiveDom}`);
        if (effectiveDom) {
          ok = true;
          break;
        }
      }

      log.push(`⚠️ ${hk} 未检测到选区变化，尝试下一个候选...`);
    }

    const screenshot = await captureScreenshot(page);
    return {
      success: ok,
      log,
      screenshot,
      output: {
        hotkey: usedHotkey || hotkeyRaw,
        triedHotkeys: candidates,
        targetSelector,
        repeat,
      },
      ...(ok ? {} : { error: '未检测到选区变化（可能未聚焦/快捷键被系统拦截/Meta-Control 映射不一致/目标非可选中元素）' }),
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.push(`❌ 快捷键执行失败: ${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  }
}
