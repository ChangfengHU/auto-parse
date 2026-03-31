import { NextRequest, NextResponse } from 'next/server';
import { saveXhsPost } from '@/lib/content-storage-hybrid';
import { uploadXhsImageFromUrl } from '@/lib/oss';

/**
 * POST /api/content/save/xhs
 * 先将所有图片上传到 OSS，全部成功后再保存到数据库。
 * 任意图片上传失败则直接返回错误，不写库。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { noteData, originalUrl } = body;

    if (!noteData) {
      return NextResponse.json({ error: '缺少 noteData' }, { status: 400 });
    }

    const imageList: any[] = (noteData as any).imageList || noteData.images || [];

    // ── Step 1: 先把所有图片上传到 OSS ──────────────────────────────────────
    const tempId = `tmp_${Date.now()}`;
    const ossImages: { original_url: string; oss_url: string }[] = [];

    for (let i = 0; i < imageList.length; i++) {
      const img = imageList[i];
      const srcUrl: string = img.previewUrl || img.originalUrl || img.urlDefault || img.url || '';
      if (!srcUrl) {
        return NextResponse.json({ error: `第 ${i + 1} 张图片没有有效 URL` }, { status: 400 });
      }

      console.log(`上传图片 ${i + 1}/${imageList.length}: ${srcUrl}`);
      try {
        const ossUrl = await uploadXhsImageFromUrl(srcUrl, `xhs/${tempId}/image_${i}.jpg`);
        console.log(`✅ 图片 ${i + 1} 上传成功: ${ossUrl}`);
        ossImages.push({ original_url: srcUrl, oss_url: ossUrl });
      } catch (e) {
        console.error(`❌ 图片 ${i + 1} 上传失败:`, e);
        return NextResponse.json(
          { error: `第 ${i + 1} 张图片上传 OSS 失败: ${String(e)}` },
          { status: 500 }
        );
      }
    }

    // ── Step 2: 所有图片上传成功，把 oss_url 注入 images，然后存库 ───────────
    const enrichedImages = imageList.map((img: any, i: number) => ({
      ...img,
      oss_url: ossImages[i]?.oss_url,
    }));

    const noteDataToSave = {
      ...noteData,
      original_url: originalUrl,
      images: enrichedImages,
      imageList: enrichedImages,
    };

    const savedPost = await saveXhsPost(noteDataToSave);
    console.log('✅ 小红书作品已保存:', savedPost.id);

    return NextResponse.json({
      success: true,
      data: {
        post: savedPost,
        message: `✅ 已保存！${ossImages.length} 张图片已上传 OSS`,
      },
    });
  } catch (error) {
    console.error('保存失败:', error);
    return NextResponse.json({ error: `保存失败: ${String(error)}` }, { status: 500 });
  }
}
