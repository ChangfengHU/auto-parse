/**
 * 视频解析 Skill
 * API 文档：https://parse.vyibc.com/api/parse
 */

export interface ParseOptions {
  /** false = 抖音无水印（Playwright，约25s）；true = 有水印快速模式（约3s）；小红书忽略此参数 */
  watermark?: boolean;
}

export interface VideoParseResult {
  success: boolean;
  platform: 'douyin' | 'xiaohongshu';
  videoId: string;
  title: string;
  videoUrl: string;   // 原始 CDN 地址（短效）
  ossUrl: string;     // OSS 永久地址（推荐使用）
  watermark: boolean; // false = 无水印
}

/**
 * 解析视频并上传到 OSS
 * @param url   - 分享链接或包含链接的分享文本
 * @param opts  - 选项（watermark 仅对抖音生效）
 */
export async function parseVideo(
  url: string,
  opts: ParseOptions = {}
): Promise<VideoParseResult> {
  const { watermark = false } = opts;

  const resp = await fetch('https://parse.vyibc.com/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, watermark }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }

  return resp.json();
}

/** 抖音无水印解析（约25s） */
export const parseDouyinNoWatermark = (url: string) =>
  parseVideo(url, { watermark: false });

/** 抖音有水印快速解析（约3s） */
export const parseDouyinFast = (url: string) =>
  parseVideo(url, { watermark: true });

/** 小红书解析（无水印，约5s） */
export const parseXiaohongshu = (url: string) =>
  parseVideo(url, {});
