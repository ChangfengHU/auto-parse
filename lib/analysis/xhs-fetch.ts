/**
 * 小红书纯 HTTP 引擎
 * 移植自 XHS-Downloader:
 *   - request.py   → fetchHtml()
 *   - converter.py → extractInitialState()
 *   - explore.py   → extractPostMeta()
 *   - image.py     → buildImageUrls()
 *   - video.py     → buildVideoUrl()
 */

import vm from 'vm';
import { getXhsCookie } from './xhs-cookie';

// ── 常量（来自 static.py）─────────────────────────────────────────────────────

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BASE_HEADERS: Record<string, string> = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9',
  referer: 'https://www.xiaohongshu.com/explore',
  'user-agent': USER_AGENT,
};

// ── 类型 ──────────────────────────────────────────────────────────────────────

export interface XhsAuthor {
  id: string;
  name: string;
  avatar: string;
}

export interface XhsImage {
  index: number;
  previewUrl: string;   // 带压缩后缀的 CDN 地址（直接用于 <img> 预览）
  originalUrl: string;  // 去掉压缩后缀的原图地址
  liveUrl?: string;     // Live Photo 对应的小视频
}

export interface XhsPostData {
  noteId: string;
  postUrl: string;
  title: string;
  desc: string;
  type: 'image' | 'video' | 'unknown';
  author: XhsAuthor;
  stats: {
    likes: number;
    comments: number;
    shares: number;
    collects: number;
  };
  tags: string[];
  publishTime: string;
  images: XhsImage[];
  video?: { url: string };
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/** 安全取嵌套字段，路径如 "user.userId" */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeGet(obj: any, path: string, def: unknown = ''): unknown {
  try {
    return path.split('.').reduce((acc, k) => acc?.[k], obj) ?? def;
  } catch {
    return def;
  }
}

const toNum = (v: unknown) => parseInt(String(v ?? '0')) || 0;

// ── request.py 移植：fetchHtml ─────────────────────────────────────────────────

/**
 * 解析短链 / 确保最终拿到完整的 explore URL
 * xhslink.com 等短链会重定向到真实地址
 */
export async function resolveUrl(url: string): Promise<string> {
  if (!url.startsWith('http')) url = `https://${url}`;
  const cookie = getXhsCookie();
  const headers: Record<string, string> = { ...BASE_HEADERS };
  if (cookie) headers['cookie'] = cookie;

  const res = await fetch(url, {
    method: 'HEAD',
    headers,
    redirect: 'follow',
  }).catch(() => null);

  return res?.url ?? url;
}

/** 带 Cookie 获取 XHS 页面 HTML */
async function fetchHtml(url: string): Promise<string> {
  const cookie = getXhsCookie();
  if (!cookie) throw new Error('未设置小红书 Cookie，请先在页面顶部输入 Cookie');

  const headers: Record<string, string> = { ...BASE_HEADERS, cookie };

  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`请求失败 HTTP ${res.status}，Cookie 可能已失效`);
  return res.text();
}

// ── converter.py 移植：extractInitialState ────────────────────────────────────

/**
 * 从 HTML 中找到 window.__INITIAL_STATE__= 并用 vm 安全解析
 * 对应 XHS-Downloader: Converter._extract_object() + _convert_object()
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractInitialState(html: string): Record<string, any> | null {
  // 找所有 <script> 内容，取包含 __INITIAL_STATE__ 的那段
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const text = m[1].trim();
    if (!text.includes('window.__INITIAL_STATE__')) continue;

    try {
      // 去掉赋值前缀，剩下纯对象字面量
      const valueStr = text
        .replace(/^[\s\S]*?window\.__INITIAL_STATE__\s*=\s*/, '')
        .replace(/;\s*$/, '')
        .trim();

      // 用 vm 在沙盒里安全求值（避免 eval 直接污染全局）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sandbox: Record<string, any> = { undefined };
      vm.runInNewContext(`__result = ${valueStr}`, sandbox, { timeout: 5_000 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return sandbox.__result as Record<string, any>;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 从 __INITIAL_STATE__ 中取出帖子数据
 * 对应 XHS-Downloader: Converter._filter_object()，兼容 PC 和移动端两条路径
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractNoteData(state: Record<string, any>): Record<string, any> | null {
  // 新路径：直接从 state.note 获取（2024年新结构）
  try {
    if (state.note && typeof state.note === 'object') {
      // 可能的结构：state.note.noteDetailMap 或 state.note.data 等
      if (state.note.noteDetailMap) {
        const map = state.note.noteDetailMap;
        const key = Object.keys(map)[0];
        const note = map[key]?.note;
        if (note?.noteId) return note;
      }
      
      // 或者直接在 note 字段下
      if (state.note.noteId) return state.note;
      
      // 或者在 note.data 下
      if (state.note.data?.noteId) return state.note.data;
      
      // 或者在 note.data.noteData 下  
      if (state.note.data?.noteData?.noteId) return state.note.data.noteData;
    }
  } catch { /* 继续尝试 */ }

  // PC 路径：noteDetailMap.{noteId}.note（旧结构）
  try {
    const map = state.noteDetailMap;
    if (map && typeof map === 'object') {
      const key = Object.keys(map)[0];
      const note = map[key]?.note;
      if (note?.noteId) return note;
    }
  } catch { /* 继续尝试 */ }

  // 移动端路径：noteData.data.noteData（旧结构）
  try {
    const note = state?.noteData?.data?.noteData;
    if (note?.noteId) return note;
  } catch { /* ignore */ }

  // 尝试更多可能的路径
  try {
    // feed 相关路径
    if (state.feed?.noteDetailMap) {
      const map = state.feed.noteDetailMap;
      const key = Object.keys(map)[0];
      const note = map[key]?.note;
      if (note?.noteId) return note;
    }
  } catch { /* ignore */ }

  return null;
}

// ── image.py 移植：buildImageUrls ─────────────────────────────────────────────

/**
 * 从 URL 提取 token（去掉域名 + !xxx 压缩后缀）
 * 对应 XHS-Downloader: Image.__extract_image_token()
 */
function extractToken(url: string): string {
  if (!url) return '';
  // URL 形如 https://sns-img-hw.xhscdn.com/prefix/token!suffix
  return url.replace(/^https?:\/\/[^/]+\//, '').split('!')[0];
}

/**
 * 拼接高清原图地址
 * 对应 XHS-Downloader: Image.__generate_auto_link()
 */
function toOriginalUrl(url: string): string {
  const token = extractToken(url);
  return token ? `https://sns-img-bd.xhscdn.com/${token}` : url;
}

/** 构建图片列表，对应 XHS-Downloader: Image.get_image_link() */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildImages(imageList: any[]): XhsImage[] {
  return imageList.map((img, idx) => {
    const rawUrl: string = img.urlDefault || img.url || '';
    // Live Photo 视频地址：stream.h264[0].masterUrl
    const liveRaw: string = img.stream?.h264?.[0]?.masterUrl ?? '';
    return {
      index: idx + 1,
      previewUrl: rawUrl,
      originalUrl: toOriginalUrl(rawUrl),
      liveUrl: liveRaw ? decodeURIComponent(liveRaw) : undefined,
    };
  });
}

// ── video.py 移植：buildVideoUrl ─────────────────────────────────────────────

/**
 * 构建视频地址
 * 优先用 originVideoKey（最高质量），否则从 stream 中取最高分辨率
 * 对应 XHS-Downloader: Video.deal_video_link()
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildVideo(noteData: Record<string, any>): { url: string } | undefined {
  // 方式1：originVideoKey → 拼 CDN 地址
  const originKey: string = safeGet(noteData, 'video.consumer.originVideoKey') as string;
  if (originKey) return { url: `https://sns-video-bd.xhscdn.com/${originKey}` };

  // 方式2：从 h264 + h265 stream 取最高分辨率
  const h264: unknown[] = (safeGet(noteData, 'video.media.stream.h264') as unknown[]) ?? [];
  const h265: unknown[] = (safeGet(noteData, 'video.media.stream.h265') as unknown[]) ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const streams = [...(Array.isArray(h264) ? h264 : []), ...(Array.isArray(h265) ? h265 : [])] as any[];
  if (!streams.length) return undefined;

  // 按分辨率排序，取最高
  streams.sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
  const best = streams[streams.length - 1];
  const url: string = best.backupUrls?.[0] || best.masterUrl || '';
  return url ? { url } : undefined;
}

// ── explore.py 移植：extractPostMeta ─────────────────────────────────────────

/**
 * 对应 XHS-Downloader: Explore.run() + __extract_*
 * 提取互动数据、标签、作者信息等
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPostMeta(noteData: Record<string, any>, rawUrl: string): XhsPostData {
  const interact = noteData.interactInfo ?? {};
  const tags: string[] = (noteData.tagList ?? []).map((t: { name?: string }) => t.name ?? '').filter(Boolean);
  const ts: number | undefined = noteData.time;
  const publishTime = ts
    ? new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : '';

  const imageList: unknown[] = noteData.imageList ?? [];
  const images = buildImages(imageList as Parameters<typeof buildImages>[0]);
  const video = buildVideo(noteData);

  const type: XhsPostData['type'] =
    noteData.type === 'video' ? 'video' : images.length > 0 ? 'image' : 'unknown';

  return {
    noteId: noteData.noteId as string,
    postUrl: rawUrl,
    title: (noteData.title as string) ?? '',
    desc: (noteData.desc as string) ?? '',
    type,
    author: {
      id: (safeGet(noteData, 'user.userId') as string) ?? '',
      name: ((safeGet(noteData, 'user.nickname') as string) || (safeGet(noteData, 'user.nickName') as string)) ?? '',
      avatar: ((safeGet(noteData, 'user.avatar') as string) || (safeGet(noteData, 'user.avatarUrl') as string)) ?? '',
    },
    stats: {
      likes: toNum(interact.likedCount),
      comments: toNum(interact.commentCount),
      shares: toNum(interact.shareCount),
      collects: toNum(interact.collectedCount),
    },
    tags,
    publishTime,
    images,
    video,
  };
}

// ── 公开 API ──────────────────────────────────────────────────────────────────

/** 解析单个小红书帖子 */
export async function fetchXhsPost(url: string): Promise<XhsPostData> {
  // 解析短链
  const resolvedUrl = await resolveUrl(url);

  const html = await fetchHtml(resolvedUrl);

  const state = extractInitialState(html);
  if (!state) {
    throw new Error('页面数据解析失败：未找到 __INITIAL_STATE__。Cookie 可能已过期，或链接格式不对');
  }

  const noteData = extractNoteData(state);
  if (!noteData) {
    throw new Error('帖子数据提取失败：noteData 为空。请确认链接是帖子详情页');
  }

  return buildPostMeta(noteData, resolvedUrl);
}

/** 下载单个图片 Buffer（带 Referer，绕过防盗链） */
export async function downloadImageBuffer(imageUrl: string): Promise<Buffer> {
  const cookie = getXhsCookie();
  const headers: Record<string, string> = {
    referer: 'https://www.xiaohongshu.com/',
    'user-agent': USER_AGENT,
  };
  if (cookie) headers['cookie'] = cookie;

  const res = await fetch(imageUrl, { headers });
  if (!res.ok) throw new Error(`图片下载失败 HTTP ${res.status}: ${imageUrl}`);
  return Buffer.from(await res.arrayBuffer());
}
