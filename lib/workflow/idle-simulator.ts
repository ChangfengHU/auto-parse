import type { Page } from 'playwright';

/**
 * 空闲行为模拟器
 *
 * - 步骤执行间隙定时随机鼠标移动 / 滚动
 * - 检测到真实鼠标活动后自动暂停 30s，避免干扰人工操作
 */
export class IdleSimulator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private page: Page | null = null;

  // 最近一次检测到真实鼠标活动的时间
  private lastHumanActivity = 0;
  // 检测到人工操作后的冷却时间（ms）
  private readonly HUMAN_COOLDOWN = 30_000;

  start(page: Page) {
    if (this.active) return;
    this.page = page;
    this.active = true;

    // 通过页面内脚本检测鼠标活动（CDP 不支持反向 mouse 事件）

    // 通过注入脚本监听页面内的鼠标移动
    page.addInitScript(() => {
      document.addEventListener('mousemove', () => {
        // 通过 CDP 无法反向通知 Node，这里只记录时间戳到 window
        (window as Window & { __lastHumanMove?: number }).__lastHumanMove = Date.now();
      }, { passive: true });
    }).catch(() => {});

    this.schedule();
  }

  stop() {
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule() {
    const delay = 8_000 + Math.random() * 17_000;
    this.timer = setTimeout(() => {
      if (!this.active) return;
      this.doAction().finally(() => {
        if (this.active) this.schedule();
      });
    }, delay);
  }

  private async doAction() {
    if (!this.page) return;

    // 检查页面内是否有最近的鼠标活动
    const pageLastMove = await this.page.evaluate(
      () => (window as Window & { __lastHumanMove?: number }).__lastHumanMove ?? 0
    ).catch(() => 0);

    const lastActivity = Math.max(this.lastHumanActivity, pageLastMove);
    const idleTime = Date.now() - lastActivity;

    if (lastActivity > 0 && idleTime < this.HUMAN_COOLDOWN) {
      // 人工操作冷却中，跳过本次
      return;
    }

    const roll = Math.random();
    try {
      if (roll < 0.45) {
        const x = 200 + Math.random() * 800;
        const y = 100 + Math.random() * 500;
        await this.page.mouse.move(x, y);
      } else if (roll < 0.75) {
        const dy = (Math.random() - 0.5) * 120;
        await this.page.mouse.wheel(0, dy);
      } else {
        const x = 300 + Math.random() * 600;
        const y = 150 + Math.random() * 400;
        await this.page.mouse.move(x, y);
        await this.page.waitForTimeout(400 + Math.random() * 800);
        await this.page.mouse.move(
          x + (Math.random() - 0.5) * 20,
          y + (Math.random() - 0.5) * 20
        );
      }
    } catch {
      // 页面正在跳转，静默忽略
    }
  }
}
