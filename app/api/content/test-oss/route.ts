import { NextRequest, NextResponse } from 'next/server';
import { uploadXhsImageFromUrl } from '@/lib/oss';

/**
 * POST /api/content/test-oss
 * 测试图片能否上传到 OSS，不保存到数据库。
 * body: { imageUrls: string[] }
 */
export async function POST(req: NextRequest) {
  const { imageUrls } = await req.json() as { imageUrls: string[] };

  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return NextResponse.json({ error: '缺少 imageUrls' }, { status: 400 });
  }

  const results: { url: string; ossUrl?: string; error?: string }[] = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    const key = `xhs/test-oss/${Date.now()}_${i}.jpg`;
    try {
      const ossUrl = await uploadXhsImageFromUrl(url, key);
      results.push({ url, ossUrl });
    } catch (e) {
      results.push({ url, error: String(e) });
    }
  }

  const failed = results.filter(r => r.error);
  if (failed.length === results.length) {
    return NextResponse.json(
      { error: `所有图片上传失败`, results },
      { status: 500 }
    );
  }

  return NextResponse.json({ results });
}
