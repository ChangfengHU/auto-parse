/**
 * 人工暂停信号存储
 *
 * human_pause 节点执行时轮询此 Map，等待对应 token 被置为 true。
 * Resume API 调用 signalResume(token) 触发继续。
 *
 * token 格式：sessionId 或 "scratch"（node-debug 草稿页模式）
 */

declare global {
  // eslint-disable-next-line no-var
  var __pauseSignals: Map<string, boolean> | undefined;
}

function signals(): Map<string, boolean> {
  if (!global.__pauseSignals) global.__pauseSignals = new Map();
  return global.__pauseSignals;
}

export function waitForResume(token: string, timeoutMs: number): Promise<'resumed' | 'timeout'> {
  signals().set(token, false);
  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs;
    const interval = setInterval(() => {
      if (signals().get(token) === true) {
        signals().delete(token);
        clearInterval(interval);
        resolve('resumed');
      } else if (Date.now() > deadline) {
        signals().delete(token);
        clearInterval(interval);
        resolve('timeout');
      }
    }, 400);
  });
}

export function signalResume(token: string): boolean {
  if (!signals().has(token)) return false;
  signals().set(token, true);
  return true;
}

export function isPaused(token: string): boolean {
  return signals().has(token) && signals().get(token) === false;
}
