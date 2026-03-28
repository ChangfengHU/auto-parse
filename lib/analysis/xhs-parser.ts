/**
 * 小红书帖子解析器
 * 在 page.evaluate() 内部完成数据提取，只返回精简字段，
 * 避免 "object reference chain is too long" 序列化错误。
 */

import type { Page } from 'playwright';

export interface XhsAuthor {
  id: string;
  name: string;
  avatar: string;
}

export interface XhsImage {
  index: number;
  previewUrl: string;
  originalUrl: string;
  liveUrl?: string;
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

/** 从 CDN URL 提取 token（去掉域名 + !xxx 压缩后缀），拼接原图地址 */
function toOriginalUrl(url: string): string {
  if (!url) return '';
  const token = url.replace(/^https?:\/\/[^/]+\//, '').split('!')[0];
  return token ? `https://sns-img-bd.xhscdn.com/${token}` : url;
}

// ── 核心：在浏览器上下文内提取精简数据 ──────────────────────────────────────────

interface RawNote {
  noteId: string;
  title: string;
  desc: string;
  type: string;
  time: number;
  imageList: { urlDefault: string; url: string; liveUrl: string }[];
  video: {
    originVideoKey: string;
    streams: { masterUrl: string; backupUrl: string; height: number }[];
  };
  interactInfo: { likedCount: string; commentCount: string; shareCount: string; collectedCount: string };
  tagList: { name: string }[];
  user: { userId: string; nickname: string; avatar: string };
}

async function extractRawNote(page: Page): Promise<RawNote | null> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = (window as any).__INITIAL_STATE__;
    if (!state) return null;

    // 尝试 PC 路径：noteDetailMap.{id}.note
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let n: any = null;
    try {
      const map = state.noteDetailMap;
      if (map) {
        const key = Object.keys(map)[0];
        if (key) n = map[key]?.note;
      }
    } catch { /* ignore */ }

    // 尝试移动端路径：noteData.data.noteData
    if (!n) {
      try { n = state?.noteData?.data?.noteData; } catch { /* ignore */ }
    }

    if (!n?.noteId) return null;

    // 图片列表 —— 只取必要字段
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imageList = (n.imageList ?? []).map((img: any) => ({
      urlDefault: img.urlDefault ?? img.url ?? '',
      url: img.url ?? '',
      liveUrl: img.stream?.h264?.[0]?.masterUrl ?? '',
    }));

    // 视频流 —— h264 + h265 合并后取最后一条（最高质量）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allStreams = [...(n.video?.media?.stream?.h264 ?? []), ...(n.video?.media?.stream?.h265 ?? [])].map((s: any) => ({
      masterUrl: s.masterUrl ?? '',
      backupUrl: s.backupUrls?.[0] ?? '',
      height: s.height ?? 0,
    }));

    return {
      noteId: n.noteId ?? '',
      title: n.title ?? '',
      desc: n.desc ?? '',
      type: n.type ?? '',
      time: n.time ?? 0,
      imageList,
      video: {
        originVideoKey: n.video?.consumer?.originVideoKey ?? '',
        streams: allStreams,
      },
      interactInfo: {
        likedCount: String(n.interactInfo?.likedCount ?? '0'),
        commentCount: String(n.interactInfo?.commentCount ?? '0'),
        shareCount: String(n.interactInfo?.shareCount ?? '0'),
        collectedCount: String(n.interactInfo?.collectedCount ?? '0'),
      },
      tagList: (n.tagList ?? []).map((t: { name?: string }) => ({ name: t.name ?? '' })),
      user: {
        userId: n.user?.userId ?? '',
        nickname: n.user?.nickname ?? n.user?.nickName ?? '',
        avatar: n.user?.avatar ?? n.user?.avatarUrl ?? '',
      },
    };
  });
}

// ── 公开 API ──────────────────────────────────────────────────────────────────

export async function parseXhsPost(page: Page, url: string): Promise<XhsPostData> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2_500);

  const raw = await extractRawNote(page);

  if (!raw) {
    throw new Error('无法获取帖子数据，请先执行「小红书扫码登录」工作流完成登录');
  }

  // 图片
  const images: XhsImage[] = raw.imageList.map((img, idx) => ({
    index: idx + 1,
    previewUrl: img.urlDefault || img.url,
    originalUrl: toOriginalUrl(img.urlDefault || img.url),
    liveUrl: img.liveUrl ? decodeURIComponent(img.liveUrl) : undefined,
  }));

  // 视频
  let video: XhsPostData['video'] | undefined;
  if (raw.video.originVideoKey) {
    video = { url: `https://sns-video-bd.xhscdn.com/${raw.video.originVideoKey}` };
  } else if (raw.video.streams.length > 0) {
    const best = raw.video.streams[raw.video.streams.length - 1];
    const vUrl = best.backupUrl || best.masterUrl;
    if (vUrl) video = { url: vUrl };
  }

  const toNum = (s: string) => parseInt(s) || 0;
  const publishTime = raw.time
    ? new Date(raw.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : '';

  const type: XhsPostData['type'] =
    raw.type === 'video' ? 'video' : images.length > 0 ? 'image' : 'unknown';

  return {
    noteId: raw.noteId,
    postUrl: `https://www.xiaohongshu.com/explore/${raw.noteId}`,
    title: raw.title,
    desc: raw.desc,
    type,
    author: {
      id: raw.user.userId,
      name: raw.user.nickname,
      avatar: raw.user.avatar,
    },
    stats: {
      likes: toNum(raw.interactInfo.likedCount),
      comments: toNum(raw.interactInfo.commentCount),
      shares: toNum(raw.interactInfo.shareCount),
      collects: toNum(raw.interactInfo.collectedCount),
    },
    tags: raw.tagList.map(t => t.name).filter(Boolean),
    publishTime,
    images,
    video,
  };
}
