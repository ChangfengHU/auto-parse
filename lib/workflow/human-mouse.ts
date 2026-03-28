import type { Page } from 'playwright';

// 记录上一次鼠标位置（模块级）
let _lastX = 640;
let _lastY = 400;

export function updateMousePos(x: number, y: number) {
  _lastX = x;
  _lastY = y;
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

/** 三次贝塞尔插值 */
function bezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

/**
 * 人工鼠标移动：从上次位置经贝塞尔曲线移动到目标坐标
 * 速度在开始/结束时慢，中间快（模拟真实手部加速度）
 */
export async function humanMouseMove(page: Page, toX: number, toY: number): Promise<void> {
  const fromX = _lastX;
  const fromY = _lastY;
  const dx = toX - fromX;
  const dy = toY - fromY;

  // 随机控制点（让曲线有轻微弧度）
  const cp1x = fromX + dx * rand(0.2, 0.4) + rand(-40, 40);
  const cp1y = fromY + dy * rand(0.2, 0.4) + rand(-40, 40);
  const cp2x = fromX + dx * rand(0.6, 0.8) + rand(-40, 40);
  const cp2y = fromY + dy * rand(0.6, 0.8) + rand(-40, 40);

  const steps = Math.floor(rand(16, 28));

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(bezier(t, fromX, cp1x, cp2x, toX));
    const y = Math.round(bezier(t, fromY, cp1y, cp2y, toY));
    await page.mouse.move(x, y);
    // 开始/结束慢，中间快
    const speedFactor = t < 0.2 || t > 0.8 ? rand(18, 32) : rand(4, 12);
    await page.waitForTimeout(speedFactor);
  }

  updateMousePos(toX, toY);
}
