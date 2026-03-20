const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

const CHROME_PROFILE = path.join(
  os.homedir(),
  'Library/Application Support/Google/Chrome'
);

(async () => {
  console.log('启动 Chrome（使用本地登录状态）...');

  // 用持久化 context 复用已有的 Chrome 登录状态
  const context = await chromium.launchPersistentContext(CHROME_PROFILE, {
    channel: 'chrome',
    headless: false,
    slowMo: 500,
    args: ['--no-first-run', '--no-default-browser-check'],
    viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = await context.newPage();

  // ── Step 1: 进入上传页 ──────────────────────────
  console.log('\n[1] 打开上传页...');
  await page.goto('https://creator.douyin.com/creator-micro/content/upload', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(2000);

  // 截图
  await page.screenshot({ path: '/tmp/dy-upload.png', fullPage: false });
  console.log('截图已保存: /tmp/dy-upload.png');

  // ── Step 2: 找上传相关 Tab ──────────────────────
  const tabInfo = await page.evaluate(() => {
    return [...document.querySelectorAll('[class*="tab"], [class*="Tab"], [class*="header"] span, [class*="header"] div')]
      .filter(el => {
        const t = (el.innerText || '').trim();
        return ['发布视频', '发布图文', '发布文章', '发布全景'].some(k => t === k);
      })
      .map(el => ({ tag: el.tagName, class: el.className, text: el.innerText.trim() }));
  });
  console.log('\n[Tab 信息]', JSON.stringify(tabInfo, null, 2));

  // ── Step 3: 找视频 file input ───────────────────
  const fileInputs = await page.evaluate(() =>
    [...document.querySelectorAll('input[type="file"]')]
      .map(el => ({ class: el.className, accept: el.accept, id: el.id }))
  );
  console.log('\n[File Inputs]', JSON.stringify(fileInputs, null, 2));

  // ── Step 4: 点「发布视频」tab（如果找得到）──────
  try {
    const videoTab = page.locator('text=发布视频').first();
    const visible = await videoTab.isVisible({ timeout: 3000 });
    if (visible) {
      await videoTab.click();
      console.log('\n[2] 已点击「发布视频」tab');
      await page.waitForTimeout(1500);
    }
  } catch { console.log('未找到「发布视频」tab，可能已在视频上传页'); }

  // ── Step 5: 用测试文件触发上传（跳过，直接访问 post 页）──
  // 直接进 post 页看表单结构
  console.log('\n[3] 进入 post/video 页...');
  await page.goto('https://creator.douyin.com/creator-micro/content/post/video', {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/dy-post.png', fullPage: false });
  console.log('截图已保存: /tmp/dy-post.png');

  // ── Step 6: 提取表单选择器 ──────────────────────
  const formInfo = await page.evaluate(() => {
    const titleEls = [...document.querySelectorAll('input, textarea, [contenteditable="true"]')]
      .filter(el => {
        const ph = el.placeholder || el.getAttribute('data-placeholder') || '';
        return ph.includes('标题') || ph.includes('描述');
      })
      .map(el => ({
        tag: el.tagName,
        class: el.className,
        placeholder: el.placeholder || el.getAttribute('data-placeholder'),
        contenteditable: el.getAttribute('contenteditable'),
      }));

    const btns = [...document.querySelectorAll('button')]
      .filter(el => el.innerText && (el.innerText.includes('发布') || el.innerText.includes('提交')))
      .map(el => ({ class: el.className, text: el.innerText.trim(), disabled: el.disabled }));

    return { titleEls, btns };
  });
  console.log('\n[表单选择器]', JSON.stringify(formInfo, null, 2));

  await page.waitForTimeout(3000);
  await context.close();
  console.log('\n完成！');
})();
