import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing URL parameter' }, { status: 400 });
  }

  try {
    // 尝试多种配置获取图片
    const configs = [
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
          'Accept': 'image/*',
          'Referer': 'https://www.xiaohongshu.com/',
        } as Record<string, string>,
      },
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/webp,image/apng,image/avif,image/*,*/*;q=0.8',
          'Referer': 'https://www.xiaohongshu.com/',
        } as Record<string, string>,
      },
      {
        headers: {
          'User-Agent': 'curl/7.68.0',
        } as Record<string, string>,
      },
    ];

    let response: Response | null = null;
    let lastError: any = null;

    for (const config of configs) {
      try {
        response = await fetch(imageUrl, {
          method: 'GET',
          ...config,
        });

        if (response.ok) {
          break;
        } else {
          console.log(`配置失败 ${response.status}，尝试下一个...`);
        }
      } catch (error) {
        lastError = error;
        console.log('配置失败，尝试下一个...', error);
      }
    }

    if (!response || !response.ok) {
      throw lastError || new Error('All configs failed');
    }

    // 获取图片数据
    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });

  } catch (error) {
    console.error('代理图片失败:', error);
    return NextResponse.json(
      { error: 'Failed to fetch image' },
      { status: 500 }
    );
  }
}