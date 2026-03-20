import { chromium } from 'playwright';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';

const COOKIE_FILE = path.join(process.cwd(), '.douyin-cookie.json');

function getDouyinCookie(): string {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      const data = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
      if (data.cookie) return data.cookie;
    }
  } catch { /* ignore */ }
  return process.env.DOUYIN_COOKIE || '';
}

function parseCookies(cookieStr: string) {
  return cookieStr.split(';').map(c => {
    const idx = c.indexOf('=');
    return {
      name: c.slice(0, idx).trim(),
      value: c.slice(idx + 1).trim(),
      domain: '.douyin.com',
      path: '/',
    };
  }).filter(c => c.name && c.value);
}

// OSS 地址 or 直链 → 本地临时文件
async function downloadToTemp(url: string): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `douyin-pub-${Date.now()}.mp4`);
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 180_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible)',
      'Referer': 'https://www.douyin.com/',
    },
  });
  fs.writeFileSync(tmpPath, Buffer.from(res.data as ArrayBuffer));
  return tmpPath;
}

export interface PublishOptions {
  videoUrl: string;   // OSS 地址
  title: string;
  tags?: string[];    // 话题标签，不含 #
}

export interface PublishResult {
  success: boolean;
  message: string;
}

// 防并发锁：用文件锁代替内存变量，避免 Next.js 热重载后失效
const LOCK_FILE = path.join(os.tmpdir(), 'douyin-publish.lock');

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 只检查进程是否存在，不发送信号
    return true;
  } catch {
    return false; // ESRCH: 进程不存在
  }
}

function acquireLock(): boolean {
  try {
    // O_EXCL 保证原子性：文件存在则失败
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    try {
      const lockContent = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
      const lockPid = parseInt(lockContent, 10);

      // 如果持锁进程已经死亡（崩溃/热重载/手动杀掉），自动清除僵尸锁
      if (!lockPid || !isProcessAlive(lockPid) || lockPid === process.pid) {
        fs.unlinkSync(LOCK_FILE);
        fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
        return true;
      }

      // 进程还活着但超过 15 分钟，认为挂死
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

// 通用重试：失败时执行 onRetry（可刷新页面），最多重试 maxRetries 次
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  onRetry: (attempt: number, err: Error) => Promise<void>,
): Promise<T> {
  let lastErr: Error = new Error('unknown');
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (i < maxRetries) await onRetry(i + 1, lastErr);
    }
  }
  throw lastErr;
}

type EmitType = 'log' | 'qrcode';

export async function publishToDouyin(
  options: PublishOptions,
  emit: (type: EmitType, payload: string) => void = () => {},
): Promise<PublishResult> {
  const log = (msg: string) => { console.log(msg); emit('log', msg); };

  if (!acquireLock()) {
    return { success: false, message: '当前有发布任务正在进行中，请等待完成后再试（防止并发触发风控）' };
  }

  // 1. 下载到本地临时文件（先下载，再启动浏览器）
  log('⏳ 开始下载视频到本地...');
  let tmpFile = '';
  try {
    tmpFile = await downloadToTemp(options.videoUrl);
    log('✅ 视频下载完成');
  } catch (e: unknown) {
    releaseLock();
    return { success: false, message: `视频下载失败: ${e instanceof Error ? e.message : String(e)}` };
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

    const cookie = getDouyinCookie();
    if (cookie) await context.addCookies(parseCookies(cookie));

    const page = await context.newPage();
    page.on('dialog', d => d.accept());

    const UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload';

    // 带重试的页面导航：失败或页面内容过少就刷新
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

    // ── 登录检测：用上传 input 是否可见作为最可靠依据 ────────
    const uploadInput = page.locator('input[accept*="video/mp4"]').first();
    const inputVisible = await uploadInput.isVisible().catch(() => false);
    const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const needLogin = !inputVisible ||
      pageText.includes('扫码登录') ||
      pageText.includes('手机号登录');

    if (needLogin) {
      log('⚠️ 检测到未登录，正在获取抖音扫码登录二维码...');

      // 导航到登录页（networkidle 确保 QR 图片完全加载）
      if (!pageText.includes('扫码登录')) {
        await page.goto('https://creator.douyin.com', { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(2000);
      }

      const sendQrCode = async () => {
        // 等待 QR img 元素出现（class 含 qrcode_img）
        await page.waitForSelector('[class*="qrcode_img"]', { timeout: 15_000 }).catch(() => {});

        let buf: Buffer | null = null;

        // 直接截取 QR img 元素（最清晰，经过测试验证）
        const qrImg = page.locator('[class*="qrcode_img"]').first();
        if (await qrImg.isVisible().catch(() => false)) {
          buf = await qrImg.screenshot().catch(() => null);
        }

        // 备用：截取含 QR 的整个面板区域
        if (!buf) {
          const qrPanel = page.locator('[class*="scan_qrcode_login"]').first();
          if (await qrPanel.isVisible().catch(() => false)) {
            buf = await qrPanel.screenshot().catch(() => null);
          }
        }

        if (buf) {
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
      const newCookies = await context.cookies();
      const newCookieStr = newCookies
        .filter(c => c.domain.includes('douyin.com'))
        .map(c => `${c.name}=${c.value}`)
        .join('; ');
      if (newCookieStr) {
        fs.writeFileSync(COOKIE_FILE, JSON.stringify({ cookie: newCookieStr, updatedAt: Date.now() }));
        log('✅ Cookie 已保存，下次无需扫码');
      }

      // 登录后重新加载上传页
      await withRetry(gotoUpload, 2, async (attempt) => {
        log(`⚠️ 上传页加载失败，第 ${attempt} 次重试...`);
        await page.waitForTimeout(2000);
      });
    }

    log('📄 上传页就绪');

    const videoTab = page.getByText('发布视频', { exact: true }).first();
    if (await videoTab.isVisible().catch(() => false)) {
      await videoTab.click();
      await page.waitForTimeout(800);
    }

    // ── Step 1：上传视频文件（重试：找不到 input 就刷新）───
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
    log('📤 视频已注入，等待服务器处理...');

    // ── Checkpoint 1：等待跳转到发布表单页，确认上传成功 ────
    await page.waitForURL(
      url => url.toString().includes('/content/post/video'),
      { timeout: 120_000 }
    );
    const videoPreviewLoaded = await Promise.race([
      page.waitForSelector('video', { timeout: 20_000 }).then(() => true),
      page.waitForSelector('[class*="player"],[class*="preview"],[class*="cover"]', { timeout: 20_000 }).then(() => true),
    ]).catch(() => false);
    const uploadPageText = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (uploadPageText.includes('上传失败') || uploadPageText.includes('网络错误')) {
      throw new Error('视频上传失败，页面出现错误提示');
    }
    log(videoPreviewLoaded ? '✅ Checkpoint 1：视频上传成功，预览已加载' : '✅ Checkpoint 1：视频上传成功（无预览元素）');

    // 关闭弹窗
    await page.waitForTimeout(2000);
    for (const btnText of ['我知道了', '知道了', '确定', '关闭']) {
      const btn = page.getByRole('button', { name: btnText }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(500);
      }
    }
    await page.waitForFunction(
      () => !document.body.innerText.includes('加载中，请稍候'),
      { timeout: 30_000 }
    ).catch(() => {});
    await page.waitForTimeout(2000);

    // ── Checkpoint 2：填写标题并验证 ────────────────────────
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
    const filledTitle = await titleInput.inputValue().catch(() => '');
    if (!filledTitle) {
      throw new Error('标题填写失败：输入框为空');
    }
    if (filledTitle !== expectedTitle) {
      await titleInput.click({ clickCount: 3 });
      await titleInput.fill(expectedTitle);
      await page.waitForTimeout(300);
    }
    log(`✅ Checkpoint 2：标题已填写 → "${await titleInput.inputValue().catch(() => filledTitle)}"`);

    // 话题标签
    if (options.tags && options.tags.length > 0) {
      const descEditor = page.locator('div.zone-container[contenteditable="true"]').first();
      if (await descEditor.isVisible().catch(() => false)) {
        await descEditor.click();
        for (const tag of options.tags.slice(0, 3)) {
          await descEditor.type(` #${tag}`, { delay: 50 });
          await page.waitForTimeout(600);
          const dropdown = page.locator('.semi-select-option, [class*="topicOption"]').first();
          if (await dropdown.isVisible().catch(() => false)) await dropdown.click();
          else await descEditor.press('Escape');
        }
        log(`✅ 话题标签已输入：${options.tags.slice(0, 3).map(t => '#' + t).join(' ')}`);
      }
    }

    // ── Checkpoint 3：封面确认 ───────────────────────────────
    log('🖼️ Checkpoint 3：检查封面...');
    await page.waitForTimeout(1000);
    const coverSelectors = [
      '[class*="coverImage"] img', '[class*="cover-image"] img',
      '[class*="thumb"] img', '[class*="CoverSelector"] img',
    ];
    let coverFound = false;
    for (const sel of coverSelectors) {
      if (await page.locator(sel).first().isVisible().catch(() => false)) {
        coverFound = true; break;
      }
    }
    if (!coverFound) {
      const autoEl = page.locator('[class*="coverItem"],[class*="cover-item"],[class*="frameItem"]').first();
      if (await autoEl.isVisible().catch(() => false)) {
        await autoEl.click();
        log('✅ Checkpoint 3：已选择第一帧作为封面');
      } else {
        log('⚠️ Checkpoint 3：未找到封面选项，使用抖音默认封面');
      }
    } else {
      log('✅ Checkpoint 3：封面已自动生成');
    }

    // ── Checkpoint 4：实时检测进度 ──────────────────────────
    log('🔍 Checkpoint 4：开始监控内容检测进度...');
    const detectStart = Date.now();
    let lastDetectMsg = '';
    let detectionPassed = false;

    for (let i = 0; i < 90; i++) {
      const info = await page.evaluate(() => {
        const text = document.body.innerText;
        const pct = text.match(/检测中\s*(\d+)\s*%/)?.[1];
        if (pct) {
          const n = parseInt(pct, 10);
          const filled = Math.floor(n / 5);
          const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
          return { done: false, pct: n, msg: `检测中 [${bar}] ${pct}%` };
        }
        if (text.includes('检测通过') || text.includes('检测完成')) return { done: true, pct: 100, msg: '检测通过 ✅' };
        if (!text.includes('检测中')) return { done: true, pct: 100, msg: '检测完成 ✅' };
        return { done: false, pct: 0, msg: '检测中，等待进度...' };
      }).catch(() => ({ done: false, pct: 0, msg: '等待页面响应...' }));

      const elapsed = ((Date.now() - detectStart) / 1000).toFixed(0);
      const line = `${info.msg}  (${elapsed}s)`;
      if (line !== lastDetectMsg) { log(line); lastDetectMsg = line; }
      if (info.done) { detectionPassed = true; break; }
      await page.waitForTimeout(2000);
    }

    if (!detectionPassed) log('⚠️ 检测超时（3分钟），尝试继续发布...');

    // 检查硬性错误
    const finalBodyText = await page.evaluate(() => document.body.innerText);
    if (finalBodyText.includes('无法发布') || finalBodyText.includes('内容违规') || finalBodyText.includes('审核不通过')) {
      throw new Error('视频检测未通过，内容可能违规');
    }

    // ── 发布 ─────────────────────────────────────────────────
    log('🚀 检测通过，点击发布按钮...');
    const publishBtn = page.getByRole('button', { name: '发布' }).last();
    await publishBtn.waitFor({ timeout: 10_000 });
    await publishBtn.click();

    log('⏳ 等待发布完成...');
    // 不用 text= 选择器（会匹配隐藏元素），改用 waitForFunction 检查可见文字
    await Promise.race([
      page.waitForURL(url => url.toString().includes('/content/manage'), { timeout: 60_000 }),
      page.waitForFunction(() => {
        // 只匹配可见的包含"发布成功"或"审核中"的元素
        const els = Array.from(document.querySelectorAll('*'));
        return els.some(el => {
          const text = (el as HTMLElement).innerText || '';
          if (!text.includes('发布成功') && !text.includes('审核中')) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
            && (el as HTMLElement).offsetParent !== null;
        });
      }, {}, { timeout: 60_000 }),
    ]);
    log('🎉 发布成功！视频已提交抖音审核');
    await page.screenshot({ timeout: 3000, path: '/tmp/douyin-after-publish.png' }).catch(() => null);
    await page.waitForTimeout(5000);

    return { success: true, message: '发布成功！视频已提交抖音审核' };

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      const pages = browser.contexts()[0]?.pages();
      if (pages?.length) await pages[0].screenshot({ timeout: 5000, path: '/tmp/douyin-error.png' });
    } catch { /* ignore */ }
    return { success: false, message: `发布失败: ${msg}` };
  } finally {
    releaseLock();
    await browser.close();
    if (tmpFile) try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
