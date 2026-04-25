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
  liveUrl?: string;
  live_url?: string;
  live_oss_url?: string;
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

type UploadedImage = {
  original_url: string;
  oss_url: string;
  live_url?: string;
  live_oss_url?: string;
};

type SaveProgressEvent = {
  type: 'progress' | 'done' | 'error';
  phase?: 'prepare' | 'image' | 'live' | 'database' | 'complete';
  current?: number;
  total?: number;
  percent?: number;
  message?: string;
  data?: unknown;
  error?: string;
};

async function saveXhsPostWithProgress(
  noteData: SaveNoteData,
  originalUrl: string | undefined,
  comments: unknown[],
  emit?: (event: SaveProgressEvent) => void
) {
  const imageList = noteData.imageList || noteData.images || [];
  const liveTotal = imageList.filter((img) => img.liveUrl || img.live_url).length;
  const total = Math.max(1, imageList.length + liveTotal + 1);
  let current = 0;

  const progress = (phase: SaveProgressEvent['phase'], message: string) => {
    emit?.({
      type: 'progress',
      phase,
      current,
      total,
      percent: Math.round((current / total) * 100),
      message,
    });
  };

  progress('prepare', `准备上传 ${imageList.length} 张图片${liveTotal ? `、${liveTotal} 条动图` : ''}`);

  // ── Step 1: 先把所有图片和 Live Photo 动图上传到存储 ─────────────────────
  const tempId = `tmp_${Date.now()}`;
  const ossImages: UploadedImage[] = [];

  for (let i = 0; i < imageList.length; i++) {
    const img = imageList[i];
    const srcUrl: string = img.previewUrl || img.originalUrl || img.urlDefault || img.url || '';
    const liveUrl: string = img.liveUrl || img.live_url || '';
    if (!srcUrl) {
      throw new Error(`第 ${i + 1} 张图片没有有效 URL`);
    }

    progress('image', `上传图片 ${i + 1}/${imageList.length}`);
    console.log(`上传图片 ${i + 1}/${imageList.length}: ${srcUrl}`);
    const ossUrl = await uploadXhsImageFromUrl(srcUrl, `xhs/${tempId}/image_${i}.jpg`);
    current += 1;
    progress('image', `图片 ${i + 1}/${imageList.length} 上传完成`);
    console.log(`✅ 图片 ${i + 1} 上传成功: ${ossUrl}`);

    let liveOssUrl = img.live_oss_url || '';
    if (liveUrl && !liveOssUrl) {
      progress('live', `上传动图 ${i + 1}/${imageList.length}`);
      console.log(`上传动图 ${i + 1}/${imageList.length}: ${liveUrl}`);
      liveOssUrl = await uploadVideoFromUrl(liveUrl, `xhs/${tempId}/image_${i}_live.mp4`);
      current += 1;
      progress('live', `动图 ${i + 1}/${imageList.length} 上传完成`);
      console.log(`✅ 动图 ${i + 1} 上传成功: ${liveOssUrl}`);
    }

    ossImages.push({
      original_url: srcUrl,
      oss_url: ossUrl,
      live_url: liveUrl || undefined,
      live_oss_url: liveOssUrl || undefined,
    });
  }

  // ── Step 2: 所有媒体上传成功，把 oss_url/live_oss_url 注入 images，然后存库 ─
  progress('database', '写入作品素材库');
  const enrichedImages = imageList.map((img, i) => ({
    ...img,
    oss_url: ossImages[i]?.oss_url,
    live_url: ossImages[i]?.live_url || img.live_url || img.liveUrl,
    live_oss_url: ossImages[i]?.live_oss_url || img.live_oss_url,
  }));

  let savedVideo: SaveNoteData['video'] | undefined;
  const sourceVideoUrl = noteData.video?.url || noteData.video?.original_url;
  if (sourceVideoUrl) {
    // 视频文件可能较大，保存作品时先记录原始直链，避免同步转存导致页面长时间无响应。
    // 后续如果需要永久化视频，可基于 rpa_videos.upload_status=pending 做后台补传。
    savedVideo = {
      ...noteData.video,
      original_url: sourceVideoUrl,
      oss_url: noteData.video?.oss_url,
    };
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
  current += 1;
  progress('complete', '保存完成');
  console.log('✅ 小红书作品已保存:', savedPost.id);
  const liveUploadedCount = ossImages.filter((image) => image.live_oss_url).length;

  return {
    post: savedPost,
    message: `✅ 已保存！${ossImages.length} 张图片${liveUploadedCount ? `、${liveUploadedCount} 条动图` : ''}已上传`,
  };
}

/**
 * POST /api/content/save/xhs
 * 先将所有图片和 Live Photo 动图上传到当前上传后端，全部成功后再保存到数据库。
 * 任意图片上传失败则直接返回错误，不写库。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { noteData, originalUrl, comments = [], streamProgress = false } = body as {
      noteData?: SaveNoteData;
      originalUrl?: string;
      comments?: unknown[];
      streamProgress?: boolean;
    };

    if (!noteData) {
      return NextResponse.json({ error: '缺少 noteData' }, { status: 400 });
    }

    if (streamProgress) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: SaveProgressEvent) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          };
          try {
            const data = await saveXhsPostWithProgress(noteData, originalUrl, comments, send);
            send({ type: 'done', phase: 'complete', current: 1, total: 1, percent: 100, message: data.message, data });
          } catch (error) {
            console.error('保存失败:', error);
            send({ type: 'error', error: error instanceof Error ? error.message : String(error) });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        },
      });
    }

    const data = await saveXhsPostWithProgress(noteData, originalUrl, comments);

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('保存失败:', error);
    return NextResponse.json({ error: `保存失败: ${String(error)}` }, { status: 500 });
  }
}
