import crypto from 'crypto';
import axios from 'axios';
import type { ParseR2Config } from '@/lib/parse/types';
import { uploadBufferToR2 } from '@/lib/upload/r2';

type WechatImage = {
  index?: number;
  src?: string;
  previewUrl?: string;
  originalUrl?: string;
  alt?: string;
  ossUrl?: string;
};

type WechatParsed = Record<string, unknown> & {
  title?: string;
  desc?: string;
  author?: { name?: string };
  publishTime?: string;
  coverUrl?: string;
  text?: string;
  contentHtml?: string;
  images?: WechatImage[];
  originalUrl?: string;
  resolvedUrl?: string;
  sourceType?: string;
  stats?: Record<string, number>;
};

function escapeHtml(input: string) {
  return String(input || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeName(input: string) {
  return String(input || 'wechat')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'wechat';
}

function extFromContentType(contentType: string, fallback = 'jpg') {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  return fallback;
}

async function uploadRemoteImage(url: string, keyBase: string, r2: Partial<ParseR2Config>) {
  if (!url || !url.startsWith('http')) return '';
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      Referer: 'https://mp.weixin.qq.com/',
    },
    validateStatus: (status) => status >= 200 && status < 400,
  });
  const contentType = String(response.headers['content-type'] || 'image/jpeg').split(';')[0];
  const ext = extFromContentType(contentType);
  return uploadBufferToR2(Buffer.from(response.data), `${keyBase}.${ext}`, contentType, r2);
}

function buildArticleHtml(input: WechatParsed, images: WechatImage[], coverOssUrl: string) {
  const title = input.title || '微信图文';
  const author = input.author?.name || '';
  const bodyParagraphs = String(input.text || input.desc || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('\n');
  let preservedHtml = String(input.contentHtml || '');
  for (const image of images) {
    const oss = image.ossUrl || image.originalUrl || image.previewUrl || image.src || '';
    const originals = [image.src, image.previewUrl, image.originalUrl, (image as WechatImage & { rawSrc?: string }).rawSrc].filter(Boolean) as string[];
    for (const original of originals) {
      preservedHtml = preservedHtml.split(original).join(oss);
      preservedHtml = preservedHtml.split(escapeHtml(original)).join(escapeHtml(oss));
    }
  }
  const imageHtml = preservedHtml ? '' : images
    .filter((image) => image.ossUrl || image.originalUrl || image.previewUrl || image.src)
    .map((image) => {
      const src = image.ossUrl || image.originalUrl || image.previewUrl || image.src || '';
      return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(image.alt || title)}" loading="lazy" /></figure>`;
    })
    .join('\n');
  const stats = input.stats || {};
  const statsHtml = input.sourceType === 'channels'
    ? `<div class="stats"><span>点赞 ${stats.likeCount || 0}</span><span>评论 ${stats.commentCount || 0}</span><span>分享 ${stats.shareCount || 0}</span><span>收藏 ${stats.collectCount || 0}</span></div>`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta property="og:title" content="${escapeHtml(title)}" />
  ${coverOssUrl ? `<meta property="og:image" content="${escapeHtml(coverOssUrl)}" />` : ''}
  <style>
    :root { color-scheme: light; --bg:#f5f7fb; --card:#fff; --text:#172033; --muted:#6b7280; --line:#e5e7eb; --brand:#16a34a; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif; line-height:1.82; }
    .page { max-width:820px; margin:0 auto; padding:28px 16px 60px; }
    article { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:28px; box-shadow:0 8px 30px rgba(15,23,42,.06); }
    .wechat-content { overflow:hidden; word-break:break-word; }
    .wechat-content * { max-width:100%; }
    .wechat-content img { max-width:100% !important; height:auto !important; }
    .wechat-content section, .wechat-content p { max-width:100%; }
    .wechat-content [style*="text-align:center"], .wechat-content [style*="text-align: center"] { text-align:center !important; }
    h1 { font-size:28px; line-height:1.35; margin:0 0 12px; letter-spacing:0; }
    .meta { display:flex; flex-wrap:wrap; gap:8px 14px; color:var(--muted); font-size:14px; margin-bottom:22px; }
    .cover { width:100%; border-radius:14px; overflow:hidden; border:1px solid var(--line); margin:18px 0 24px; background:#111; }
    .cover img { width:100%; display:block; object-fit:cover; }
    p { margin:1em 0; font-size:16px; white-space:pre-wrap; }
    figure { margin:18px 0; }
    figure img { width:100%; max-height:880px; object-fit:contain; display:block; border-radius:12px; border:1px solid var(--line); background:#f3f4f6; }
    .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:18px 0; }
    .stats span { text-align:center; border:1px solid var(--line); border-radius:10px; padding:8px 6px; color:var(--muted); font-size:13px; background:#f8fafc; }
    .links { margin-top:26px; padding-top:18px; border-top:1px solid var(--line); font-size:13px; color:var(--muted); word-break:break-all; }
    .links a { color:var(--brand); }
    @media (max-width:640px) { article{padding:20px;} h1{font-size:23px;} .stats{grid-template-columns:repeat(2,1fr);} }
  </style>
</head>
<body>
  <div class="page">
    <article>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta"><span>${escapeHtml(author)}</span><span>${escapeHtml(input.publishTime || '')}</span><span>${input.sourceType === 'channels' ? '微信视频号' : '微信公众号'}</span></div>
      ${coverOssUrl ? `<div class="cover"><img src="${escapeHtml(coverOssUrl)}" alt="${escapeHtml(title)}" /></div>` : ''}
      ${statsHtml}
      ${preservedHtml ? `<section class="wechat-content">${preservedHtml}</section>` : `<section>${bodyParagraphs}</section>`}
      ${imageHtml ? `<section class="images">${imageHtml}</section>` : ''}
      <div class="links">原文：<a href="${escapeHtml(input.resolvedUrl || input.originalUrl || '')}" target="_blank" rel="noopener noreferrer">${escapeHtml(input.resolvedUrl || input.originalUrl || '')}</a></div>
    </article>
  </div>
</body>
</html>`;
}

export async function publishWechatHtml(input: WechatParsed, r2Config: Partial<ParseR2Config>) {
  const id = crypto.createHash('sha1').update(String(input.resolvedUrl || input.originalUrl || input.title || Date.now())).digest('hex').slice(0, 12);
  const baseName = `wechat-${id}`;
  const r2 = { ...r2Config, path: 'wechat' };
  let coverOssUrl = '';
  const coverUrl = String(input.coverUrl || '');
  if (coverUrl) {
    try { coverOssUrl = await uploadRemoteImage(coverUrl, `${baseName}-cover`, r2); } catch { coverOssUrl = coverUrl; }
  }
  const uploadedImages: WechatImage[] = [];
  for (const image of input.images || []) {
    const source = image.originalUrl || image.previewUrl || image.src || '';
    let ossUrl = '';
    try { ossUrl = await uploadRemoteImage(source, `${baseName}-image-${image.index || uploadedImages.length + 1}`, r2); } catch { ossUrl = source; }
    uploadedImages.push({ ...image, ossUrl, originalUrl: image.originalUrl || source, previewUrl: image.previewUrl || source });
  }
  const html = buildArticleHtml(input, uploadedImages, coverOssUrl);
  const htmlUrl = await uploadBufferToR2(Buffer.from(html, 'utf8'), `${baseName}.html`, 'text/html; charset=utf-8', r2);
  return { htmlUrl, coverOssUrl, images: uploadedImages };
}
