import { NextRequest, NextResponse } from 'next/server';
import { parseDouyin, parseDouyinFast } from '@/lib/parsers/douyin';
import { parseXiaohongshu } from '@/lib/parsers/xiaohongshu';
import { uploadVideoFromUrl, uploadVideoFromFile } from '@/lib/oss';
import { addMaterial } from '@/lib/materials';

export const maxDuration = 600;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, watermark = false } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: '请提供分享链接' }, { status: 400 });
    }

    const isDouyin =
      url.includes('v.douyin.com') || url.includes('douyin.com') || url.includes('iesdouyin.com');
    const isXhs =
      url.includes('xiaohongshu.com') || url.includes('xhslink.com');

    if (!isDouyin && !isXhs) {
      return NextResponse.json(
        { error: '暂不支持该平台，目前支持抖音、小红书' },
        { status: 400 }
      );
    }

    // 抖音支持两种模式：
    //   watermark=false → Playwright 无水印（慢，约 25s）
    //   watermark=true  → playwm 有水印（快，约 3s）
    let parsed = isXhs
      ? await parseXiaohongshu(url)
      : watermark
      ? await parseDouyinFast(url)
      : await parseDouyin(url);

    const ossKey = `${parsed.platform}/${parsed.videoId}.mp4`;
    let ossUrl = '';

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const localFile = (parsed as { localFile?: string }).localFile;
        ossUrl = localFile
          ? await uploadVideoFromFile(localFile, ossKey)
          : await uploadVideoFromUrl(parsed.videoUrl, ossKey);
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        parsed = isXhs
          ? await parseXiaohongshu(url)
          : watermark
          ? await parseDouyinFast(url)
          : await parseDouyin(url);
      }
    }

    const result = {
      success: true,
      platform: parsed.platform,
      videoId: parsed.videoId,
      title: parsed.title ?? '',
      videoUrl: parsed.videoUrl,
      ossUrl,
      watermark: (parsed as { watermark?: boolean }).watermark ?? watermark,
    };

    // 解析成功后自动写入素材库
    addMaterial({
      platform: result.platform,
      title: result.title,
      videoUrl: result.videoUrl,
      ossUrl: result.ossUrl,
      watermark: result.watermark,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    console.error('[parse error]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
