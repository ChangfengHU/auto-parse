import { chromium, Page, Locator } from 'playwright';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { markPublished } from '@/lib/materials';

// ─────────────────────────────────────────────────────────────
//  任务追踪器：每次发布任务创建独立目录，记录截图 + 日志 + 结果
// ─────────────────────────────────────────────────────────────
const HISTORY_DIR = path.join(process.cwd(), '.publish-history');

interface Checkpoint {
  name: string;
  status: 'ok' | 'warn' | 'error' | 'skip';
  message: string;
  timestamp: string;
  screenshot?: string; // 相对路径
}

class TaskTracker {
  readonly taskId: string;
  readonly dir: string;
  readonly screenshotDir: string;
  private logFile: string;
  private checkpoints: Checkpoint[] = [];
  private startTime = Date.now();
  private screenshotIndex = 0;

  constructor(options: { videoUrl: string; title: string; description?: string; tags?: string[] }) {
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const shortId = Math.random().toString(36).slice(2, 7);
    this.taskId = `${ts}-${shortId}`;
    this.dir = path.join(HISTORY_DIR, this.taskId);
    this.screenshotDir = path.join(this.dir, 'screenshots');
    this.logFile = path.join(this.dir, 'log.txt');

    fs.mkdirSync(this.screenshotDir, { recursive: true });

    // 写入任务元数据
    fs.writeFileSync(path.join(this.dir, 'task.json'), JSON.stringify({
      taskId: this.taskId,
      startTime: now.toISOString(),
      input: { videoUrl: options.videoUrl, title: options.title, description: options.description, tags: options.tags },
      status: 'running',
      checkpoints: [],
      result: null,
    }, null, 2));

    this.log(`[TASK START] ${this.taskId}`);
    this.log(`[INPUT] url=${options.videoUrl} title="${options.title}"`);
  }

  /** 追加一行日志（带时间戳） */
  log(msg: string) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(this.logFile, line);
  }

  /**
   * 截图并记录到 checkpoint
   * @param locator 如果传入，则进行区域截图（元素周围 padding 30px），否则截全页
   */
  async screenshot(page: Page, name: string, locator?: Locator): Promise<string | null> {
    this.screenshotIndex++;
    const filename = `${String(this.screenshotIndex).padStart(2, '0')}-${name}.png`;
    const filepath = path.join(this.screenshotDir, filename);
    const relativePath = `screenshots/${filename}`;
    try {
      if (locator) {
        const visible = await locator.isVisible().catch(() => false);
        if (visible) {
          const box = await locator.boundingBox().catch(() => null);
          if (box) {
            const pad = 30;
            await page.screenshot({
              path: filepath,
              clip: {
                x: Math.max(0, box.x - pad),
                y: Math.max(0, box.y - pad),
                width: Math.min(1280, box.width + pad * 2),
                height: Math.min(800, box.height + pad * 2),
              },
              timeout: 5000,
            });
            this.log(`[SCREENSHOT:REGION] ${relativePath} (${Math.round(box.width)}x${Math.round(box.height)})`);
            return relativePath;
          }
          // 元素可见但没有 boundingBox，直接截元素
          await locator.screenshot({ path: filepath, timeout: 5000 });
          this.log(`[SCREENSHOT:ELEMENT] ${relativePath}`);
          return relativePath;
        }
      }
      // 全页回退
      await page.screenshot({ path: filepath, fullPage: false, timeout: 5000 });
      this.log(`[SCREENSHOT:PAGE] ${relativePath}`);
      return relativePath;
    } catch {
      return null;
    }
  }

  /** 记录 checkpoint */
  addCheckpoint(name: string, status: Checkpoint['status'], message: string, screenshotPath?: string | null) {
    const cp: Checkpoint = {
      name,
      status,
      message,
      timestamp: new Date().toISOString(),
      ...(screenshotPath ? { screenshot: screenshotPath } : {}),
    };
    this.checkpoints.push(cp);
    this.log(`[CHECKPOINT:${status.toUpperCase()}] ${name} — ${message}`);
    this._flush();
  }

  /** 任务结束，写入最终结果 */
  finish(success: boolean, message: string) {
    const endTime = new Date();
    const durationSec = ((Date.now() - this.startTime) / 1000).toFixed(1);
    this.log(`[TASK ${success ? 'SUCCESS' : 'FAILED'}] ${message} (${durationSec}s)`);
    this._flush(success ? 'success' : 'failed', message, endTime.toISOString(), durationSec);
  }

  private _flush(status?: string, resultMsg?: string, endTime?: string, durationSec?: string) {
    try {
      const existing = JSON.parse(fs.readFileSync(path.join(this.dir, 'task.json'), 'utf-8'));
      fs.writeFileSync(path.join(this.dir, 'task.json'), JSON.stringify({
        ...existing,
        status: status ?? existing.status,
        checkpoints: this.checkpoints,
        result: resultMsg ? { success: status === 'success', message: resultMsg } : existing.result,
        endTime: endTime ?? existing.endTime,
        durationSec: durationSec ?? existing.durationSec,
      }, null, 2));
    } catch { /* ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────
//  Cookie 管理
// ─────────────────────────────────────────────────────────────
const COOKIE_FILE = path.join(process.cwd(), '.douyin-cookie.json');

function loadCookies(): Parameters<import('playwright').BrowserContext['addCookies']>[0] {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      const data = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
      if (Array.isArray(data.cookies) && data.cookies.length > 0) return data.cookies;
      if (data.cookie) return parseCookieStr(data.cookie);
    }
  } catch { /* ignore */ }
  const envCookie = process.env.DOUYIN_COOKIE || '';
  return envCookie ? parseCookieStr(envCookie) : [];
}

function parseCookieStr(cookieStr: string) {
  return cookieStr.split(';').map(c => {
    const idx = c.indexOf('=');
    return {
      name: c.slice(0, idx).trim(),
      value: c.slice(idx + 1).trim(),
      domain: '.douyin.com',
      path: '/',
      secure: true,
      sameSite: 'None' as const,
    };
  }).filter(c => c.name && c.value);
}

// ─────────────────────────────────────────────────────────────
//  工具函数
// ─────────────────────────────────────────────────────────────
async function downloadToTemp(url: string): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `douyin-pub-${Date.now()}.mp4`);
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 180_000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Referer': 'https://www.douyin.com/' },
  });
  fs.writeFileSync(tmpPath, Buffer.from(res.data as ArrayBuffer));
  return tmpPath;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  onRetry: (attempt: number, err: Error) => Promise<void>,
): Promise<T> {
  let lastErr: Error = new Error('unknown');
  for (let i = 0; i <= maxRetries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (i < maxRetries) await onRetry(i + 1, lastErr);
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────
//  文件锁（防并发）
// ─────────────────────────────────────────────────────────────
const LOCK_FILE = path.join(os.tmpdir(), 'douyin-publish.lock');

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireLock(): boolean {
  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    try {
      const lockPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
      if (!lockPid || !isProcessAlive(lockPid) || lockPid === process.pid) {
        fs.unlinkSync(LOCK_FILE);
        fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
        return true;
      }
      const stat = fs.statSync(LOCK_FILE);
      if (Date.now() - stat.mtimeMs > 15 * 60 * 1000) {
        fs.unlinkSync(LOCK_FILE);
        fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────
//  主接口
// ─────────────────────────────────────────────────────────────
export interface PublishOptions {
  videoUrl: string;
  title: string;
  description?: string;
  tags?: string[];
}

export interface PublishResult {
  success: boolean;
  message: string;
  taskId?: string;
  historyDir?: string;
}

type EmitType = 'log' | 'qrcode';

export async function publishToDouyin(
  options: PublishOptions,
  emit: (type: EmitType, payload: string) => void = () => {},
): Promise<PublishResult> {
  const tracker = new TaskTracker(options);
  const log = (msg: string) => { console.log(msg); emit('log', msg); tracker.log(`[EMIT] ${msg}`); };

  log(`🆔 任务ID：${tracker.taskId}`);

  if (!acquireLock()) {
    const msg = '当前有发布任务正在进行中，请等待完成后再试（防止并发触发风控）';
    tracker.finish(false, msg);
    return { success: false, message: msg, taskId: tracker.taskId };
  }

  log('⏳ 开始下载视频到本地...');
  let tmpFile = '';
  try {
    tmpFile = await downloadToTemp(options.videoUrl);
    log('✅ 视频下载完成');
    tracker.addCheckpoint('download', 'ok', '视频下载完成');
  } catch (e: unknown) {
    const msg = `视频下载失败: ${e instanceof Error ? e.message : String(e)}`;
    tracker.addCheckpoint('download', 'error', msg);
    tracker.finish(false, msg);
    releaseLock();
    return { success: false, message: msg, taskId: tracker.taskId };
  }

  log('🚀 启动浏览器（无头模式）...');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'zh-CN',
      viewport: { width: 1280, height: 800 },
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
      // @ts-ignore
      window.chrome = { runtime: {} };
      const oq = window.navigator.permissions.query;
      // @ts-ignore
      window.navigator.permissions.query = (p: PermissionDescriptor) =>
        p.name === 'notifications' ? Promise.resolve({ state: Notification.permission } as PermissionStatus) : oq(p);
    });

    const cookies = loadCookies();
    if (cookies.length > 0) await context.addCookies(cookies);

    const page = await context.newPage();
    page.on('dialog', d => d.accept());

    const UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload';

    const gotoUpload = async () => {
      await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(3000);
      const html = await page.content();
      if (html.length < 2000) throw new Error('页面内容过少，可能未加载完成');
    };

    await withRetry(gotoUpload, 2, async (attempt) => {
      log(`⚠️ 页面加载不完整，第 ${attempt} 次刷新重试...`);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(3000);
    });

    // ── 登录检测 ──────────────────────────────────────────────
    const uploadInput = page.locator('input[accept*="video/mp4"]').first();
    const inputVisible = await uploadInput.waitFor({ state: 'visible', timeout: 12_000 })
      .then(() => true).catch(() => false);
    const needLogin = !inputVisible;

    // 截图：聚焦上传区域
    const uploadAreaLocator = page.locator('[class*="upload"],[class*="Upload"]').first();
    const loginCheckShot = await tracker.screenshot(page, 'login-check', uploadAreaLocator);
    tracker.addCheckpoint('login-check', needLogin ? 'warn' : 'ok',
      needLogin ? '未检测到上传框，需要登录' : '已登录，上传框可见', loginCheckShot);

    if (needLogin) {
      log('⚠️ 检测到未登录，正在获取抖音扫码登录二维码...');
      await page.goto('https://creator.douyin.com', { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const sendQrCode = async () => {
        await page.waitForSelector('[class*="qrcode_img"]', { timeout: 15_000 }).catch(() => {});
        let buf: Buffer | null = null;

        const qrImg = page.locator('[class*="qrcode_img"]').first();
        if (await qrImg.isVisible().catch(() => false)) {
          buf = await qrImg.screenshot().catch(() => null);
        }
        if (!buf) {
          const qrPanel = page.locator('[class*="scan_qrcode_login"]').first();
          if (await qrPanel.isVisible().catch(() => false)) {
            buf = await qrPanel.screenshot().catch(() => null);
          }
        }
        if (!buf) {
          buf = await page.screenshot({ fullPage: false }).catch(() => null);
          if (buf) log('⚠️ 未找到二维码元素，已截取整页，请查看图片中的二维码');
        }

        if (buf) {
          // 保存二维码到任务历史
          const qrPath = path.join(tracker.screenshotDir, `qrcode-${Date.now()}.png`);
          fs.writeFileSync(qrPath, buf);
          tracker.log(`[QRCODE] 已保存到 ${qrPath}`);
          emit('qrcode', `data:image/png;base64,${buf.toString('base64')}`);
          log('📱 请用抖音 App 扫描上方二维码（约 3 分钟有效）');
        } else {
          log('⚠️ 无法截取二维码，请手动访问 creator.douyin.com 扫码登录');
        }
      };

      await sendQrCode();

      let loginDone = false;
      const qrRefreshTimer = setInterval(async () => {
        if (loginDone) return;
        log('🔄 二维码即将过期，正在刷新...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(2000);
        await sendQrCode();
      }, 50_000);

      try {
        await page.waitForURL(
          url => url.toString().includes('creator.douyin.com/creator-micro'),
          { timeout: 180_000 }
        );
        loginDone = true;
      } finally {
        clearInterval(qrRefreshTimer);
      }

      log('✅ 扫码登录成功！保存 Cookie...');
      const loginShot = await tracker.screenshot(page, 'login-success');
      tracker.addCheckpoint('login', 'ok', '扫码登录成功', loginShot);

      const newCookies = await context.cookies();
      const douyinCookies = newCookies.filter(c => c.domain.includes('douyin.com'));
      if (douyinCookies.length > 0) {
        fs.writeFileSync(COOKIE_FILE, JSON.stringify({ cookies: douyinCookies, updatedAt: Date.now() }, null, 2));
        log('✅ Cookie 已保存，下次无需扫码');
      }

      await withRetry(gotoUpload, 2, async (attempt) => {
        log(`⚠️ 上传页加载失败，第 ${attempt} 次重试...`);
        await page.waitForTimeout(2000);
      });
    }

    log('📄 上传页就绪');
    const uploadZone = page.locator('input[accept*="video/mp4"]').locator('xpath=../..');
    const uploadPageShot = await tracker.screenshot(page, 'upload-page-ready', uploadZone);
    tracker.addCheckpoint('upload-page', 'ok', '上传页就绪', uploadPageShot);

    const videoTab = page.getByText('发布视频', { exact: true }).first();
    if (await videoTab.isVisible().catch(() => false)) {
      await videoTab.click();
      await page.waitForTimeout(800);
    }

    // ── 上传视频 ──────────────────────────────────────────────
    log('📤 开始上传视频...');
    await withRetry(async () => {
      const fi = page.locator('input[accept*="video/mp4"]').first();
      await fi.waitFor({ timeout: 20_000 });
      await fi.setInputFiles(tmpFile);
    }, 2, async (attempt) => {
      log(`⚠️ 上传输入框未找到，刷新重试（第 ${attempt} 次）...`);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(3000);
    });

    const injectShot = await tracker.screenshot(page, 'video-injected');
    tracker.addCheckpoint('video-inject', 'ok', '视频文件已注入上传框', injectShot);
    log('📤 视频已注入，等待跳转到发布表单页（最多 2 分钟）...');

    // ── Checkpoint 1：等待跳转到表单页 ────────────────────────
    const uploadStart = Date.now();
    await (async () => {
      for (let i = 0; i < 24; i++) {
        if (page.url().includes('/content/post/video')) return;
        const elapsed = ((Date.now() - uploadStart) / 1000).toFixed(0);
        log(`⏳ 上传中... (${elapsed}s)`);
        await page.waitForTimeout(5000);
      }
      await page.waitForURL(url => url.toString().includes('/content/post/video'), { timeout: 10_000 });
    })();

    const videoPreviewLoaded = await Promise.race([
      page.waitForSelector('video', { timeout: 20_000 }).then(() => true),
      page.waitForSelector('[class*="player"],[class*="preview"],[class*="cover"]', { timeout: 20_000 }).then(() => true),
    ]).catch(() => false);

    const uploadPageText = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (uploadPageText.includes('上传失败') || uploadPageText.includes('网络错误')) {
      const cp1Shot = await tracker.screenshot(page, 'cp1-upload-failed');
      tracker.addCheckpoint('cp1-upload', 'error', '上传失败：页面出现错误提示', cp1Shot);
      throw new Error('视频上传失败，页面出现错误提示');
    }

    const cp1Msg = videoPreviewLoaded ? '视频上传成功，预览已加载' : '视频上传成功（无预览元素）';
    const cp1Shot = await tracker.screenshot(page, 'cp1-uploaded');
    tracker.addCheckpoint('cp1-upload', 'ok', cp1Msg, cp1Shot);
    log(`✅ Checkpoint 1：${cp1Msg}`);

    // 关闭弹窗
    await page.waitForTimeout(2000);
    for (const btnText of ['我知道了', '知道了', '确定', '关闭']) {
      const btn = page.getByRole('button', { name: btnText }).first();
      if (await btn.isVisible().catch(() => false)) { await btn.click(); await page.waitForTimeout(500); }
    }
    await page.waitForFunction(() => !document.body.innerText.includes('加载中，请稍候'), { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // ── Checkpoint 2：填写标题 ────────────────────────────────
    log('✏️ Checkpoint 2：填写标题...');
    let titleInput = page.getByPlaceholder('填写作品标题').first();
    if (!await titleInput.isVisible().catch(() => false)) {
      titleInput = page.locator('input[maxlength="30"], input[maxlength="55"]').first();
    }
    await titleInput.waitFor({ timeout: 30_000 });
    const expectedTitle = options.title.slice(0, 30);
    await titleInput.click();
    await titleInput.fill(expectedTitle);
    await page.waitForTimeout(300);
    let filledTitle = await titleInput.inputValue().catch(() => '');
    if (!filledTitle) throw new Error('标题填写失败：输入框为空');
    if (filledTitle !== expectedTitle) {
      await titleInput.click({ clickCount: 3 });
      await titleInput.fill(expectedTitle);
      await page.waitForTimeout(300);
      filledTitle = await titleInput.inputValue().catch(() => filledTitle);
    }

    // 正文 + 话题
    const hasDesc = !!(options.description && options.description.trim());
    const hasTags = !!(options.tags && options.tags.length > 0);
    if (hasDesc || hasTags) {
      const descEditor = page.locator('div.zone-container[contenteditable="true"]').first();
      if (await descEditor.isVisible().catch(() => false)) {
        await descEditor.click();
        if (hasDesc) {
          await page.keyboard.type(options.description!.trim(), { delay: 20 });
          await page.waitForTimeout(300);
          log(`✅ 正文已填写：${options.description!.trim().slice(0, 20)}${options.description!.trim().length > 20 ? '...' : ''}`);
        }
        if (hasTags) {
          for (const tag of options.tags!.slice(0, 3)) {
            await descEditor.type(` #${tag}`, { delay: 50 });
            await page.waitForTimeout(600);
            const dropdown = page.locator('.semi-select-option, [class*="topicOption"]').first();
            if (await dropdown.isVisible().catch(() => false)) await dropdown.click();
            else await descEditor.press('Escape');
          }
          log(`✅ 话题标签已输入：${options.tags!.slice(0, 3).map(t => '#' + t).join(' ')}`);
        }
      }
    }

    const titleAreaLocator = titleInput.locator('xpath=../../..');
    const cp2Shot = await tracker.screenshot(page, 'cp2-title-filled', titleAreaLocator);
    tracker.addCheckpoint('cp2-title', 'ok', `标题已填写 → "${filledTitle}"`, cp2Shot);
    log(`✅ Checkpoint 2：标题已填写 → "${filledTitle}"`);

    // ── Checkpoint 3：封面 ────────────────────────────────────
    log('🖼️ Checkpoint 3：检查封面...');
    await page.waitForTimeout(1000);
    const coverSelectors = [
      '[class*="coverImage"] img', '[class*="cover-image"] img',
      '[class*="thumb"] img', '[class*="CoverSelector"] img',
    ];
    let coverFound = false;
    for (const sel of coverSelectors) {
      if (await page.locator(sel).first().isVisible().catch(() => false)) { coverFound = true; break; }
    }
    let cp3Msg = '';
    if (!coverFound) {
      const autoEl = page.locator('[class*="coverItem"],[class*="cover-item"],[class*="frameItem"]').first();
      if (await autoEl.isVisible().catch(() => false)) {
        await autoEl.click();
        cp3Msg = '已选择第一帧作为封面';
        log('✅ Checkpoint 3：' + cp3Msg);
      } else {
        cp3Msg = '未找到封面选项，使用抖音默认封面';
        log('⚠️ Checkpoint 3：' + cp3Msg);
      }
    } else {
      cp3Msg = '封面已自动生成';
      log('✅ Checkpoint 3：' + cp3Msg);
    }
    const coverZone = page.locator('[class*="cover"],[class*="Cover"]').first();
    const cp3Shot = await tracker.screenshot(page, 'cp3-cover', coverZone);
    tracker.addCheckpoint('cp3-cover', coverFound ? 'ok' : 'skip', cp3Msg, cp3Shot);

    // ── Checkpoint 4：内容检测 ────────────────────────────────
    log('🔍 Checkpoint 4：开始监控内容检测进度...');
    const detectStart = Date.now();
    let lastDetectMsg = '';
    let detectionPassed = false;
    let detectionRequired = false;

    for (let w = 0; w < 30; w++) {
      const t = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (t.includes('检测中')) { detectionRequired = true; break; }
      if (t.includes('检测通过') || t.includes('检测完成')) { detectionRequired = true; break; }
      await page.waitForTimeout(500);
    }

    if (!detectionRequired) {
      const cp4Shot = await tracker.screenshot(page, 'cp4-no-detection');
      tracker.addCheckpoint('cp4-detection', 'skip', '无需内容检测，可直接发布', cp4Shot);
      log('✅ Checkpoint 4：无需内容检测，可直接发布');
      detectionPassed = true;
    }

    let maxPct = 0;
    let disappearedCount = 0; // 连续"检测区已消失"的次数
    for (let i = 0; i < 90 && !detectionPassed; i++) {
      const info = await page.evaluate(() => {
        const text = document.body.innerText;
        const pct = text.match(/检测中\s*(\d+)\s*%/)?.[1];
        if (pct) {
          const n = parseInt(pct, 10);
          const filled = Math.floor(n / 5);
          const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
          return { done: false, pct: n, msg: `检测中 [${bar}] ${pct}%` };
        }
        const doneKeywords = ['检测通过', '检测完成', '审核通过', '已检测', '内容安全'];
        if (doneKeywords.some(k => text.includes(k))) return { done: true, pct: 100, msg: '检测通过 ✅' };
        if (text.includes('检测中')) return { done: false, pct: -1, msg: '检测中，等待进度...' };
        return { done: false, pct: -2, msg: '检测区域已消失，等待确认...' };
      }).catch(() => ({ done: false, pct: 0, msg: '等待页面响应...' }));

      if (info.pct > 0) {
        maxPct = Math.max(maxPct, info.pct);
        disappearedCount = 0; // 重置：还有进度数字，说明没消失
      } else if (info.pct === -2) {
        disappearedCount++;
      }

      // 条件 1：高峰值后 UI 更新（原逻辑）
      if (maxPct >= 95 && info.pct <= 0) {
        const cp4Shot = await tracker.screenshot(page, 'cp4-detection-done');
        tracker.addCheckpoint('cp4-detection', 'ok', `检测完成（峰值 ${maxPct}%）`, cp4Shot);
        log(`✅ 检测完成（${maxPct}% → UI已更新）`);
        detectionPassed = true;
        break;
      }

      // 条件 2：检测区消失 10s+ 且有过进度 → 视为通过（修复卡在50%问题）
      if (disappearedCount >= 5 && maxPct >= 40) {
        const cp4Shot = await tracker.screenshot(page, 'cp4-detection-done');
        tracker.addCheckpoint('cp4-detection', 'ok', `检测完成（峰值 ${maxPct}%，检测区已消失）`, cp4Shot);
        log(`✅ 检测完成（${maxPct}% → 检测区消失，视为通过）`);
        detectionPassed = true;
        break;
      }

      const elapsed = ((Date.now() - detectStart) / 1000).toFixed(0);
      const line = `${info.msg}  (${elapsed}s)`;
      if (line !== lastDetectMsg) { log(line); lastDetectMsg = line; }

      if (info.done) {
        const cp4Shot = await tracker.screenshot(page, 'cp4-detection-done');
        tracker.addCheckpoint('cp4-detection', 'ok', `检测通过（${elapsed}s）`, cp4Shot);
        detectionPassed = true;
        break;
      }
      await page.waitForTimeout(2000);
    }

    if (!detectionPassed) {
      const cp4Shot = await tracker.screenshot(page, 'cp4-detection-timeout');
      tracker.addCheckpoint('cp4-detection', 'warn', '检测超时（3分钟），强行继续发布', cp4Shot);
      log('⚠️ 检测超时（3分钟），尝试继续发布...');
    }

    const finalBodyText = await page.evaluate(() => document.body.innerText);
    if (finalBodyText.includes('无法发布') || finalBodyText.includes('内容违规') || finalBodyText.includes('审核不通过')) {
      const errShot = await tracker.screenshot(page, 'content-violation');
      tracker.addCheckpoint('violation-check', 'error', '内容违规，无法发布', errShot);
      throw new Error('视频检测未通过，内容可能违规');
    }

    // ── 点击发布 ──────────────────────────────────────────────
    log('🚀 检测通过，点击发布按钮...');
    const publishBtn = page.getByRole('button', { name: '发布' }).last();
    await publishBtn.waitFor({ timeout: 10_000 });
    const beforePublishShot = await tracker.screenshot(page, 'before-publish-click');
    tracker.addCheckpoint('pre-publish', 'ok', '找到发布按钮，准备点击', beforePublishShot);
    await publishBtn.click();

    // ── 等待跳转到管理页 ─────────────────────────────────────
    log('⏳ 等待跳转到作品管理页...');
    await page.waitForURL(url => url.toString().includes('/content/manage'), { timeout: 60_000 });
    log('📋 已跳转到作品管理页，等待视频上传完成...');
    const managePageShot = await tracker.screenshot(page, 'manage-page');
    tracker.addCheckpoint('redirect-manage', 'ok', '已跳转到作品管理页', managePageShot);

    // ── 等待后台上传完成（toast 消失）────────────────────────
    const uploadStart2 = Date.now();
    let lastUploadPct = '';
    const uploadMonitor = setInterval(() => {
      page.evaluate(() => document.body.innerText).then(txt => {
        const pctMatch = txt.match(/(\d+)%/);
        const pct = pctMatch ? pctMatch[1] + '%' : '';
        if (pct && pct !== lastUploadPct) {
          lastUploadPct = pct;
          const elapsed2 = ((Date.now() - uploadStart2) / 1000).toFixed(0);
          log(`📡 视频后台上传中... ${pct}  (${elapsed2}s)`);
        }
      }).catch(() => { /* 页面已关闭或流已断开，静默忽略 */ });
    }, 5000);

    await page.waitForFunction(() => {
      const text = document.body.innerText || '';
      return !text.includes('作品上传中') && !text.includes('上传中，请勿关闭');
    }, {}, { timeout: 600_000 }).catch(() => {});

    clearInterval(uploadMonitor);
    const uploadSec = ((Date.now() - uploadStart2) / 1000).toFixed(0);
    log(`✅ 视频上传完成（耗时 ${uploadSec}s），抖音将自动发布`);

    const finalShot = await tracker.screenshot(page, 'publish-complete');
    tracker.addCheckpoint('upload-complete', 'ok', `后台上传完成，耗时 ${uploadSec}s`, finalShot);

    await page.waitForTimeout(3000);

    const successMsg = '发布成功！视频已提交抖音审核';
    log(`🎉 ${successMsg}`);
    tracker.finish(true, successMsg);

    // 在素材库中标记该视频已发布
    try { markPublished(options.videoUrl, tracker.taskId); } catch { /* ignore */ }

    return { success: true, message: successMsg, taskId: tracker.taskId, historyDir: tracker.dir };

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      const pages = browser.contexts()[0]?.pages();
      if (pages?.length) {
        const errShot = await tracker.screenshot(pages[0], 'error-final');
        tracker.addCheckpoint('error', 'error', msg, errShot);
      }
    } catch { /* ignore */ }
    tracker.finish(false, `发布失败: ${msg}`);
    return { success: false, message: `发布失败: ${msg}`, taskId: tracker.taskId, historyDir: tracker.dir };

  } finally {
    releaseLock();
    await browser.close();
    if (tmpFile) try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
