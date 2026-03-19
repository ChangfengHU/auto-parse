import { NextRequest, NextResponse } from 'next/server';
import { parseDouyin } from '@/lib/parsers/douyin';
import { parseXiaohongshu } from '@/lib/parsers/xiaohongshu';
import { uploadVideoFromUrl } from '@/lib/oss';

export const maxDuration = 300; // 5 分钟，用于部署到 Vercel 时

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: '请提供分享链接' }, { status: 400 });
    }

    // 平台检测
    const isDouyin =
      url.includes('v.douyin.com') || url.includes('douyin.com') || url.includes('iesdouyin.com');
    const isXhs =
      url.includes('xiaohongshu.com') || url.includes('xhslink.com');

    if (!isDouyin && !isXhs) {
      return NextResponse.json({ error: '暂不支持该平台，目前支持抖音、小红书' }, { status: 400 });
    }

    // 解析视频真实地址
    // 抖音 CDN URL 有时效性，失败时重新解析最多重试 3 次
    let parsed = isDouyin ? await parseDouyin(url) : await parseXiaohongshu(url);
    const ossKey = `${parsed.platform}/${parsed.videoId}.mp4`;
    let ossUrl = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        ossUrl = await uploadVideoFromUrl(parsed.videoUrl, ossKey);
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        console.log(`[retry ${attempt}] 下载失败，重新解析...`);
        parsed = isDouyin ? await parseDouyin(url) : await parseXiaohongshu(url);
      }
    }

    return NextResponse.json({
      success: true,
      platform: parsed.platform,
      videoId: parsed.videoId,
      title: parsed.title ?? '',
      videoUrl: parsed.videoUrl,
      ossUrl,
      watermark: (parsed as { watermark?: boolean }).watermark ?? true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    console.error('[parse error]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
