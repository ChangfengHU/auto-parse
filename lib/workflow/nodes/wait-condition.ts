import type { Page } from 'playwright';
import type { WaitConditionParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';

/** 解析条件表达式，如 "value > 90" → 判断函数 */
function parseCondition(condition: string): (value: number) => boolean {
  const m = condition.match(/value\s*([><=!]+)\s*(\d+)/);
  if (!m) return () => true;
  const [, op, numStr] = m;
  const n = parseInt(numStr, 10);
  switch (op) {
    case '>':  return v => v > n;
    case '>=': return v => v >= n;
    case '<':  return v => v < n;
    case '<=': return v => v <= n;
    case '==':
    case '===': return v => v === n;
    default: return () => true;
  }
}

export async function executeWaitCondition(
  page: Page,
  params: WaitConditionParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  const timeout = params.timeout ?? 60_000;
  const pollInterval = params.pollInterval ?? 2_000;
  const timeoutAction = params.timeoutAction ?? 'continue';
  const start = Date.now();

  let maxValue = 0;
  let disappearedCount = 0;
  let lastMsg = '';

  const emit = (msg: string) => {
    if (msg !== lastMsg) {
      log.push(msg);
      ctx.emit?.('log', msg);
      lastMsg = msg;
    }
  };

  emit(`⏳ 开始等待条件：${params.condition ?? params.urlContains ?? params.textMatch ?? params.selector}`);

  const conditionFn = params.condition ? parseCondition(params.condition) : null;

  for (let i = 0; i < 999; i++) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);

    // ── 条件1：URL 包含 ────────────────────────────────────────────────
    if (params.urlContains) {
      const url = page.url();
      const excluded = params.excludeUrls?.some(u => url.includes(u)) ?? false;
      if (url.includes(params.urlContains) && !excluded) {
        emit(`✅ URL 条件满足：${url} (${elapsed}s)`);
        const screenshot = await captureScreenshot(page);
        return { success: true, log, screenshot, output: { url } };
      }
    }

    // ── 条件2：文字正则 + 数值判断 ────────────────────────────────────
    if (params.textMatch) {
      const text = await page.evaluate(() => document.body.innerText).catch(() => '');
      const regex = new RegExp(params.textMatch);
      const match = text.match(regex);

      if (match) {
        disappearedCount = 0;
        // 提取第一个数字
        const numMatch = match[0].match(/\d+/);
        const value = numMatch ? parseInt(numMatch[0], 10) : 0;
        maxValue = Math.max(maxValue, value);

        const filled = Math.floor(value / 5);
        const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
        emit(`检测中 [${bar}] ${value}%  (${elapsed}s)`);

        // 通过条件
        if (conditionFn && conditionFn(value)) {
          emit(`✅ 数值条件满足：${value} (${elapsed}s)`);
          const screenshot = await captureScreenshot(page);
          return { success: true, log, screenshot, output: { value, maxValue } };
        }
      } else {
        // 文字消失了
        disappearedCount++;
        emit(`检测区域已消失，等待确认...  (${elapsed}s)`);

        // 消失超过 10s + 曾经有过进度 → 多阶段验证
        if (disappearedCount >= 5 && maxValue >= 40) {
          await page.waitForTimeout(2000);
          const failKws: string[] = params.failKeywords ?? [];
          const successKws: string[] = params.successKeywords ?? [];
          const btnText: string = params.verifyButtonText ?? '';
          const verifyResult = await page.evaluate(
            ({ failKws, successKws, btnText }: { failKws: string[]; successKws: string[]; btnText: string }) => {
              const text = document.body.innerText;
              // 1. 失败关键词优先
              const failWord = failKws.find(k => text.includes(k));
              if (failWord) return { pass: false, reason: `页面包含失败关键词：${failWord}` };
              // 2. 成功关键词
              const successWord = successKws.find(k => text.includes(k));
              if (successWord) return { pass: true, reason: `检测通过（${successWord}）` };
              // 3. 验证按钮可点击
              if (btnText) {
                const btns = Array.from(document.querySelectorAll('button'));
                const btn = btns.find(b => b.textContent?.trim() === btnText);
                if (!btn) return { pass: false, reason: `找不到"${btnText}"按钮` };
                if ((btn as HTMLButtonElement).disabled) return { pass: false, reason: `"${btnText}"按钮已禁用` };
                return { pass: true, reason: `"${btnText}"按钮可点击` };
              }
              return { pass: true, reason: '检测区域消失，无额外验证' };
            },
            { failKws, successKws, btnText }
          ).catch(() => ({ pass: false, reason: '页面评估异常' }));

          const screenshot = await captureScreenshot(page);
          if (verifyResult.pass) {
            emit(`✅ 检测完成（峰值 ${maxValue}%，${verifyResult.reason}）`);
            return { success: true, log, screenshot, output: { maxValue, disappeared: true } };
          } else {
            emit(`❌ 检测未通过：${verifyResult.reason}`);
            return { success: false, log, error: verifyResult.reason, screenshot };
          }
        }
      }
    }

    // ── 条件3：元素出现/消失 ─────────────────────────────────────────
    if (params.selector && (params.condition === 'appeared' || params.condition === 'disappeared')) {
      const visible = await page.locator(params.selector).isVisible().catch(() => false);
      if (params.condition === 'appeared' && visible) {
        emit(`✅ 元素出现 (${elapsed}s)`);
        const screenshot = await captureScreenshot(page);
        return { success: true, log, screenshot };
      }
      if (params.condition === 'disappeared' && !visible) {
        emit(`✅ 元素消失 (${elapsed}s)`);
        const screenshot = await captureScreenshot(page);
        return { success: true, log, screenshot };
      }
    }

    // ── 超时检查 ──────────────────────────────────────────────────────
    if (Date.now() - start >= timeout) {
      const screenshot = await captureScreenshot(page);
      if (timeoutAction === 'continue') {
        emit(`⚠️ 等待超时（${timeout / 1000}s），继续执行`);
        return { success: true, log, screenshot, output: { timedOut: true, maxValue } };
      } else {
        emit(`❌ 等待超时（${timeout / 1000}s）`);
        return { success: false, log, error: '等待条件超时', screenshot };
      }
    }

    await page.waitForTimeout(pollInterval);
  }

  return { success: false, log, error: '未知错误' };
}
