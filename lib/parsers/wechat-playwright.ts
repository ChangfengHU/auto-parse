import { chromium } from 'playwright';

const CHROME_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH,
  process.env.CHROME_EXECUTABLE_PATH,
  '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean) as string[];

function resolveChromeExecutablePath(): string | undefined {
  const fs = require('fs') as typeof import('fs');
  return CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
}

function normalizeUrl(url: string) {
  if (!url) return '';
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('http://mmbiz.qpic.cn')) return 'https://' + url.slice('http://'.length);
  return url;
}

function parseNumber(value: string | undefined) {
  const text = String(value || '').replace(/[,，]/g, '').trim();
  const num = Number(text);
  return Number.isFinite(num) ? num : 0;
}

export async function parseWechat(inputUrl: string) {
  const executablePath = resolveChromeExecutablePath();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      locale: 'zh-CN',
    });
    const resp = await page.goto(inputUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
    await page.waitForTimeout(5000).catch(() => {});

    return await page.evaluate(({ inputUrl, status }) => {
      const normalize = (url: string) => {
        if (!url) return '';
        if (url.startsWith('//')) return 'https:' + url;
        if (url.startsWith('http://mmbiz.qpic.cn')) return 'https://' + url.slice('http://'.length);
        return url;
      };
      const text = (el: Element | null) => (((el as HTMLElement | null)?.innerText || el?.textContent || '')).replace(/\s+\n/g, '\n').trim();
      const meta = (selector: string) => (document.querySelector(selector)?.getAttribute('content') || '').trim();
      const finalUrl = location.href;
      const isChannels = finalUrl.includes('channels.weixin.qq.com') || inputUrl.includes('weixin.qq.com/sph/');
      const title = meta('meta[property="og:title"]') || text(document.querySelector('#activity-name')) || document.title;
      const author = meta('meta[name="author"]') || meta('meta[property="og:article:author"]') || text(document.querySelector('#js_name'));
      const desc = meta('meta[name="description"]') || meta('meta[property="og:description"]') || '';
      const coverUrl = normalize(meta('meta[property="og:image"]') || meta('meta[property="twitter:image"]'));
      const publishTime = text(document.querySelector('#publish_time')) || '';
      const contentRoot = document.querySelector('#js_content') || document.body;
      const bodyText = text(contentRoot).slice(0, 20000);
      const images = Array.from(contentRoot.querySelectorAll('img'))
        .map((img, index) => {
          const rawSrc = img.getAttribute('data-src') || img.getAttribute('src') || '';
          const src = normalize(rawSrc);
          if (src) {
            img.setAttribute('src', src);
            img.setAttribute('data-src', src);
            img.removeAttribute('data-ratio');
            img.removeAttribute('data-w');
          }
          return {
            index: index + 1,
            src,
            rawSrc,
            previewUrl: src,
            originalUrl: src,
            alt: img.getAttribute('alt') || '',
          };
        })
        .filter((img) => img.src && !img.src.startsWith('data:'))
        .slice(0, 80);
      const contentHtml = (contentRoot as HTMLElement).innerHTML || '';
      const links = Array.from(contentRoot.querySelectorAll('a'))
        .map((a, index) => ({ index: index + 1, text: text(a).slice(0, 120), href: normalize(a.getAttribute('href') || '') }))
        .filter((a) => a.href)
        .slice(0, 50);

      if (isChannels) {
        const lines = text(document.body).split('\n').map((line) => line.trim()).filter(Boolean);
        const numeric = lines.map((line) => Number(line.replace(/[,，]/g, ''))).filter((num) => Number.isFinite(num));
        const dateLine = lines.find((line) => /\d{4}年\d{1,2}月\d{1,2}日/.test(line)) || '';
        const authorLine = dateLine ? lines[lines.indexOf(dateLine) + 1] || author : author;
        return {
          success: true,
          platform: 'wechat',
          mediaType: 'video',
          sourceType: 'channels',
          status,
          originalUrl: inputUrl,
          resolvedUrl: finalUrl,
          title: lines.find((line) => line && line !== '视频号' && line !== '福州市') || title,
          desc: lines.slice(1, 4).join('\n'),
          author: { name: authorLine || '' },
          publishTime: dateLine,
          coverUrl: images[0]?.src || coverUrl,
          images,
          stats: {
            likeCount: numeric[0] || 0,
            commentCount: numeric[1] || 0,
            shareCount: numeric[2] || 0,
            collectCount: numeric[3] || 0,
          },
          text: lines.join('\n').slice(0, 12000),
          links,
        };
      }

      return {
        success: true,
        platform: 'wechat',
        mediaType: 'article',
        sourceType: 'mp_article',
        status,
        originalUrl: inputUrl,
        resolvedUrl: finalUrl,
        title,
        desc,
        author: { name: author },
        publishTime,
        coverUrl,
        images,
        imageCount: images.length,
        text: bodyText,
        contentHtml,
        links,
        captchaSuspected: /wappoc|captcha/i.test(location.href) || /验证|环境异常|继续访问/.test(text(document.body)),
      };
    }, { inputUrl, status: resp?.status() || 0 });
  } finally {
    await browser.close().catch(() => {});
  }
}
