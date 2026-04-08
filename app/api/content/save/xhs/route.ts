import { NextRequest, NextResponse } from 'next/server';
import { saveXhsPost } from '@/lib/content-storage-hybrid';
import { linkMaterialsBySourceNoteId } from '@/lib/materials';
import { uploadVideoFromUrl, uploadXhsImageFromUrl } from '@/lib/oss';

type SaveImage = {
  previewUrl?: string;
  originalUrl?: string;
  urlDefault?: string;
  url?: string;
  oss_url?: string;
};

type SaveNoteData = {
  noteId?: string;
  imageList?: SaveImage[];
  images?: SaveImage[];
  postUrl?: string;
  original_url?: string;
  video?: {
    url?: string;
    original_url?: string;
    oss_url?: string;
  };
} & Record<string, unknown>;

/**
 * POST /api/content/save/xhs
 * 先将所有图片上传到 OSS，全部成功后再保存到数据库。
 * 任意图片上传失败则直接返回错误，不写库。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { noteData, originalUrl, comments = [] } = body as {
      noteData?: SaveNoteData;
      originalUrl?: string;
      comments?: unknown[];
    };

    if (!noteData) {
      return NextResponse.json({ error: '缺少 noteData' }, { status: 400 });
    }

    const imageList = noteData.imageList || noteData.images || [];

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
    const enrichedImages = imageList.map((img, i) => ({
      ...img,
      oss_url: ossImages[i]?.oss_url,
    }));

    let savedVideo: SaveNoteData['video'] | undefined;
    const sourceVideoUrl = noteData.video?.url || noteData.video?.original_url;
    if (sourceVideoUrl) {
      try {
        const videoOssUrl = await uploadVideoFromUrl(sourceVideoUrl, `xhs/${tempId}/video.mp4`);
        savedVideo = {
          ...noteData.video,
          original_url: sourceVideoUrl,
          oss_url: videoOssUrl,
        };
      } catch (e) {
        console.error('❌ 视频上传失败:', e);
        return NextResponse.json(
          { error: `视频上传 OSS 失败: ${String(e)}` },
          { status: 500 }
        );
      }
    }

    const noteDataToSave = {
      ...noteData,
      original_url: originalUrl || noteData.postUrl || noteData.original_url || '',
      comments,
      images: enrichedImages,
      imageList: enrichedImages,
      video: savedVideo,
    };

    const savedPost = await saveXhsPost(noteDataToSave);
    const noteId = String(noteData.noteId || '').trim();
    if (noteId && savedPost?.id) {
      linkMaterialsBySourceNoteId(noteId, String(savedPost.id));
    }
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
