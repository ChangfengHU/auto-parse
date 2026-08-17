import { chromium } from 'playwright';

const CHROME_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH,
  process.env.CHROME_EXECUTABLE_PATH,
  '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean) as string[];

const YUANBAO_CDP_URL = process.env.YUANBAO_CDP_URL || 'http://127.0.0.1:9222';
let yuanbaoBrowserPromise: ReturnType<typeof chromium.connectOverCDP> | null = null;
let yuanbaoProfileQueue: Promise<void> = Promise.resolve();

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

function pickVideoUrl(feedInfo: Record<string, any> | undefined) {
  if (!feedInfo) return '';
  return feedInfo.h264VideoInfo?.videoUrl
    || feedInfo.h265VideoInfo?.videoUrl
    || feedInfo.videoUrl
    || '';
}

function pickVideoMeta(feedInfo: Record<string, any> | undefined) {
  if (!feedInfo) return {};
  return {
    h264VideoInfo: feedInfo.h264VideoInfo,
    h265VideoInfo: feedInfo.h265VideoInfo,
    videoUrl: feedInfo.videoUrl,
    mediaType: feedInfo.mediaType,
    duration: feedInfo.duration,
    width: feedInfo.width,
    height: feedInfo.height,
  };
}

function pickChannelsProfileFeedInfo(profile: Record<string, any> | null | undefined) {
  return profile?.data?.feedInfo || null;
}

function pickChannelsProfileAuthor(profile: Record<string, any> | null | undefined) {
  const authorInfo = profile?.data?.authorInfo;
  if (!authorInfo) return undefined;
  return {
    name: authorInfo.nickname || '',
    avatar: authorInfo.headImgUrl || '',
    authIconUrl: authorInfo.authIconUrl || '',
  };
}

function parseCount(text: string | undefined) {
  if (!text) return 0;
  if (text.endsWith('万')) {
    const value = Number(text.slice(0, -1));
    return Number.isFinite(value) ? Math.round(value * 10000) : 0;
  }
  return parseNumber(text);
}

function getYuanbaoBrowser() {
  if (!yuanbaoBrowserPromise) {
    yuanbaoBrowserPromise = chromium.connectOverCDP(YUANBAO_CDP_URL, { timeout: 10000 });
    yuanbaoBrowserPromise.then((browser) => {
      browser.once('disconnected', () => {
        yuanbaoBrowserPromise = null;
      });
    }).catch(() => {
      yuanbaoBrowserPromise = null;
    });
  }
  return yuanbaoBrowserPromise;
}

async function withYuanbaoProfileLock<T>(action: () => Promise<T>) {
  const previous = yuanbaoProfileQueue;
  let release = () => {};
  yuanbaoProfileQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

function selectYuanbaoHeaders(headers: Record<string, string>) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => (
    name === 'accept'
    || name === 'accept-language'
    || name === 'content-type'
    || name === 't-userid'
    || name.startsWith('x-')
  )));
}

async function captureYuanbaoHeaders(page: import('playwright').Page) {
  return await new Promise<Record<string, string>>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      page.off('request', onRequest);
    };
    const onRequest = (request: import('playwright').Request) => {
      const url = request.url();
      const headers = request.headers();
      if (!url.startsWith('https://yuanbao.tencent.com/api/') || !headers['x-device-id']) return;
      cleanup();
      resolve(selectYuanbaoHeaders(headers));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('yuanbao request headers unavailable'));
    }, 12000);
    page.on('request', onRequest);
    page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  });
}

async function fetchChannelsFeedInfo(playableUrl: string) {
  const playable = new URL(playableUrl);
  const generalToken = playable.searchParams.get('token') || '';
  const exportId = playable.searchParams.get('eid') || '';
  if (!generalToken || !exportId) throw new Error('yuanbao playable parameters missing');

  const rid = `${Math.floor(Date.now() / 1000).toString(16)}-${crypto.randomUUID().slice(0, 8)}`;
  const endpoint = `https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info?_rid=${rid}&_pageUrl=https:%2F%2Fchannels.weixin.qq.com%2Ffinder-preview%2Fpages%2Ffeed`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'content-type': 'application/json',
      origin: 'https://channels.weixin.qq.com',
      referer: `https://channels.weixin.qq.com/finder-preview/pages/feed?entry_card_type=48&comment_scene=39&appid=0&token=${encodeURIComponent(generalToken)}&entry_scene=0&eid=${encodeURIComponent(exportId)}`,
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({ baseReq: { generalToken }, exportId }),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`channels feed http ${resp.status}`);
  const result = await resp.json() as Record<string, any>;
  if (Number(result?.errCode) !== 0 || !result?.data?.feedInfo) {
    throw new Error(`channels feed error ${result?.errCode ?? 'unknown'}`);
  }
  return result;
}

async function fetchChannelsVideoProfileFromYuanbao(inputUrl: string) {
  return await withYuanbaoProfileLock(async () => {
    const browser = await getYuanbaoBrowser();
    const context = browser.contexts()[0];
    const page = context?.pages().find((candidate) => candidate.url().includes('yuanbao.tencent.com/chat'));
    if (!page) throw new Error('yuanbao login page unavailable');

    const headers = await captureYuanbaoHeaders(page);
    const parsed = await page.evaluate(async ({ inputUrl, headers }) => {
      const resp = await fetch('/api/weixin/get_parse_result', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'video_channel_url', url: inputUrl, scene: 1 }),
      });
      const result = await resp.json().catch(() => ({}));
      return { status: resp.status, result };
    }, { inputUrl, headers });
    if (parsed.status !== 200 || !parsed.result?.data?.playable_url) {
      throw new Error(`yuanbao parse http ${parsed.status}`);
    }

    const profile = await fetchChannelsFeedInfo(parsed.result.data.playable_url);
    profile.data = {
      ...profile.data,
      wxExportId: parsed.result.data.wx_export_id,
    };
    return profile;
  });
}

async function fetchChannelsVideoProfile(inputUrl: string) {
  try {
    return await fetchChannelsVideoProfileFromYuanbao(inputUrl);
  } catch (err) {
    console.warn('[wechat channels] local yuanbao profile failed', err instanceof Error ? err.message : 'unknown');
  }

  const endpoint = process.env.WECHAT_CHANNELS_PROFILE_API_URL
    || 'https://sph.litao.workers.dev/api/fetch_video_profile';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: inputUrl }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      return { error: `profile api http ${resp.status}` };
    }
    return await resp.json();
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'profile api failed' };
  } finally {
    clearTimeout(timeout);
  }
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

    const parsed = await page.evaluate(({ inputUrl, status }) => {
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

    if (parsed?.sourceType === 'channels') {
      const sceneInfo = await getChannelsSceneInfo(page);
      const feedInfo = sceneInfo?.dynamicExportId
        ? await getChannelsFeedInfo(page, sceneInfo.dynamicExportId)
        : null;
      let videoUrl = pickVideoUrl(feedInfo);
      const profile = !videoUrl ? await fetchChannelsVideoProfile(inputUrl) : null;
      const profileFeedInfo = pickChannelsProfileFeedInfo(profile);
      if (!videoUrl) {
        videoUrl = pickVideoUrl(profileFeedInfo);
      }
      const profileAuthor = pickChannelsProfileAuthor(profile);
      const profileCoverUrl = normalizeUrl(profileFeedInfo?.coverUrl || '');
      return {
        ...parsed,
        title: profileFeedInfo?.description || parsed.title,
        desc: profileFeedInfo?.description || parsed.desc,
        author: profileAuthor || parsed.author,
        coverUrl: profileCoverUrl || parsed.coverUrl,
        sceneInfo: sceneInfo ?? undefined,
        dynamicExportId: sceneInfo?.dynamicExportId,
        wxExportId: profile?.data?.wxExportId,
        videoUrl,
        videoMeta: {
          ...pickVideoMeta(feedInfo ?? undefined),
          ...pickVideoMeta(profileFeedInfo ?? undefined),
        },
        stats: profileFeedInfo ? {
          likeCount: parseCount(profileFeedInfo.likeCountFmt),
          commentCount: parseCount(profileFeedInfo.commentCountFmt),
          shareCount: parseCount(profileFeedInfo.forwardCountFmt),
          collectCount: parseCount(profileFeedInfo.favCountFmt),
        } : parsed.stats,
        channelsProfileApi: profile ? {
          source: 'profile_api',
          ok: Boolean(videoUrl),
          error: profile.error,
        } : undefined,
        feedUnavailableReason: !videoUrl
          ? profile?.error || feedInfo?.errMsg?.title || feedInfo?.errMsg || undefined
          : undefined,
      };
    }

    return parsed;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function getChannelsSceneInfo(page: import('playwright').Page) {
  return await page.evaluate(async () => {
    const params = new URLSearchParams(location.search);
    const shortUri = params.get('id') || location.href.split('/sph/')[1]?.split(/[?#]/)[0] || '';
    if (!shortUri) return null;
    const resp = await fetch('/finder-preview/api/feed/get_feed_info?_rid=auto_parse_sph&_pageUrl=https:%2F%2Fchannels.weixin.qq.com%2Ffinder-preview%2Fpages%2Fsph', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseReq: { generalToken: '' }, shortUri }),
    });
    const data = await resp.json();
    return data?.data?.sceneInfo || null;
  }).catch(() => null);
}

async function getChannelsFeedInfo(page: import('playwright').Page, exportId: string) {
  return await page.evaluate(async (exportId) => {
    const resp = await fetch('/finder-preview/api/feed/get_feed_info?_rid=auto_parse_feed&_pageUrl=https:%2F%2Fchannels.weixin.qq.com%2Ffinder-preview%2Fpages%2Ffeed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseReq: { generalToken: '' }, exportId }),
    });
    const data = await resp.json();
    return data?.data?.feedInfo || data?.data || null;
  }, exportId).catch(() => null);
}
