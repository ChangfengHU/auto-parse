import { NextRequest, NextResponse } from 'next/server';
import { ParserFactory } from '@/lib/factories/ParserFactory';
import { uploadVideoFromUrl } from '@/lib/oss';

export const maxDuration = 600; // 10分钟超时

/**
 * TikTok视频解析API
 * POST /api/parse-tiktok
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, quality = '720p' } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: '请提供TikTok分享链接' }, { status: 400 });
    }

    // 使用工厂模式获取TikTok解析器
    let parser;
    try {
      parser = ParserFactory.getParser(url);
    } catch {
      return NextResponse.json(
        { error: '暂不支持该平台，请提供TikTok链接' },
        { status: 400 }
      );
    }

    if (parser.platform !== 'tiktok') {
      return NextResponse.json(
        { error: '此接口仅支持TikTok，抖音请使用 /api/parse' },
        { status: 400 }
      );
    }

    console.log(`[TikTok] 开始解析: ${url}`);
    
    // 解析视频
    const parsed = await parser.parse(url, { quality });
    
    console.log(`[TikTok] 解析成功: ${parsed.videoId}, 开始上传OSS`);

    // 上传到OSS
    const ossKey = `tiktok/${parsed.videoId}.mp4`;
    let ossUrl = '';

    // 重试机制
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (parsed.localFile) {
          const { uploadFromFile } = await import('@/lib/oss');
          ossUrl = await uploadFromFile(parsed.localFile, ossKey);
        } else {
          ossUrl = await uploadVideoFromUrl(parsed.videoUrl, ossKey);
        }
        break;
      } catch (e) {
        console.warn(`[TikTok] 上传失败 (尝试 ${attempt}/3):`, e instanceof Error ? e.message : e);
        
        if (attempt === 3) {
          throw new Error(`OSS上传失败: ${e instanceof Error ? e.message : e}`);
        }
        
        // 重新解析（可能CDN链接过期）
        console.log(`[TikTok] 重新解析视频...`);
        const reparsed = await parser.parse(url, { quality });
        parsed.videoUrl = reparsed.videoUrl;
      }
    }

    console.log(`[TikTok] 完成: ${ossUrl}`);

    return NextResponse.json({
      success: true,
      platform: parsed.platform,
      videoId: parsed.videoId,
      title: parsed.title ?? '',
      videoUrl: parsed.videoUrl,
      ossUrl,
      watermark: parsed.watermark,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知错误';
    console.error('[TikTok parse error]', err);
    
    return NextResponse.json({ 
      error: `TikTok解析失败: ${message}` 
    }, { status: 500 });
  }
}