import { NextRequest, NextResponse } from 'next/server';
import type { XhsPostData } from '@/lib/analysis/xhs-fetch';
import { getXhsCookie } from '@/lib/analysis/xhs-cookie';
import { addMaterial } from '@/lib/materials';
import { uploadVideoFromUrl, uploadXhsImageFromUrl } from '@/lib/oss';

type SaveBody = {
  postData?: XhsPostData;
};

export const maxDuration = 600;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as SaveBody;
    const post = body.postData;
    if (!post) {
      return NextResponse.json({ error: '缺少 postData' }, { status: 400 });
    }

    const basePath = `xhs/materials/${post.noteId || Date.now()}`;
    const cookie = getXhsCookie() || undefined;
    const saved: Array<{ type: 'image' | 'video'; ossUrl: string }> = [];
    const errors: string[] = [];

    for (let i = 0; i < (post.images || []).length; i++) {
      const img = post.images[i];
      const candidates = [img.previewUrl, img.originalUrl].filter(
        (url, idx, arr): url is string => Boolean(url) && arr.indexOf(url) === idx
      );
      if (!candidates.length) continue;

      let sourceUrl = '';
      let ossUrl = '';
      let lastError = '';
      for (const candidate of candidates) {
        const ext = candidate.includes('.png') ? 'png' : candidate.includes('.webp') ? 'webp' : 'jpg';
        try {
          ossUrl = await uploadXhsImageFromUrl(
            candidate,
            `${basePath}/image_${String(i + 1).padStart(2, '0')}.${ext}`,
            cookie
          );
          sourceUrl = candidate;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      if (!ossUrl || !sourceUrl) {
        errors.push(`第 ${i + 1} 张图片上传失败：${lastError || '未知错误'}`);
        continue;
      }

      addMaterial({
        platform: 'xiaohongshu',
        mediaType: 'image',
        title: post.title ? `${post.title} · 图${i + 1}` : `小红书图片 ${i + 1}`,
        videoUrl: '',
        ossUrl,
        coverUrl: ossUrl,
        sourceUrl,
        sourceNoteId: post.noteId,
      });
      saved.push({ type: 'image', ossUrl });
    }

    const sourceVideoUrl = post.video?.url || '';
    if (sourceVideoUrl) {
      try {
        const videoOssUrl = await uploadVideoFromUrl(sourceVideoUrl, `${basePath}/video.mp4`);
        addMaterial({
          platform: 'xiaohongshu',
          mediaType: 'video',
          title: post.title || '小红书视频',
          videoUrl: sourceVideoUrl,
          ossUrl: videoOssUrl,
          coverUrl: post.images?.[0]?.previewUrl,
          sourceUrl: sourceVideoUrl,
          sourceNoteId: post.noteId,
        });
        saved.push({ type: 'video', ossUrl: videoOssUrl });
      } catch (error) {
        errors.push(`视频上传失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!saved.length) {
      return NextResponse.json({ ok: false, error: errors[0] || '无可保存素材', errors }, { status: 500 });
    }
    return NextResponse.json({ ok: true, savedCount: saved.length, saved, errors });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
