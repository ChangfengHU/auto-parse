import { NextRequest, NextResponse } from 'next/server';
import { parseDouyin, parseDouyinFast } from '@/lib/parsers/douyin';
import { fetchXhsPost } from '@/lib/analysis/xhs-fetch';
import { uploadVideoFromUrl, uploadFromFile, type UploadTargetOptions } from '@/lib/oss';
import { addMaterial } from '@/lib/materials';
import { resolveDouyinCookieForParse, getPlatformDouyinCookie, hasValidDouyinCookie } from '@/lib/parse/resolve-auth';
import type { ParseExportConfig, ParseRequestOptions } from '@/lib/parse/types';
import { DEFAULT_PARSE_EXPORT_CONFIG } from '@/lib/parse/types';

export const maxDuration = 600;

function mergeExportConfig(partial?: ParseRequestOptions['export']): ParseExportConfig {
  return {
    provider: partial?.provider ?? DEFAULT_PARSE_EXPORT_CONFIG.provider,
    r2: {
      ...DEFAULT_PARSE_EXPORT_CONFIG.r2,
      ...(partial?.r2 ?? {}),
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { url?: string; watermark?: boolean } & ParseRequestOptions;
    const { url, watermark = false, export: exportOpt, auth: authOpt } = body;

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

    const exportConfig = mergeExportConfig(exportOpt);
    const uploadTarget: UploadTargetOptions = {
      provider: exportConfig.provider,
      r2: exportConfig.r2,
    };

    if (isXhs) {
      const post = await fetchXhsPost(url);

      if (post.video?.url) {
        const sourceVideoUrl = post.video.url;
        return NextResponse.json({
          success: true,
          platform: 'xiaohongshu',
          mediaType: 'video' as const,
          videoId: post.noteId,
          title: post.title ?? '',
          desc: post.desc ?? '',
          videoUrl: sourceVideoUrl,
          ossUrl: sourceVideoUrl,
          coverUrl: post.coverUrl || post.images?.[0]?.previewUrl || '',
          noteData: post,
          savePending: true,
          watermark: false,
          uploadProvider: exportConfig.provider,
        });
      }

      if (!post.images.length) {
        return NextResponse.json({ error: '小红书笔记解析成功，但未找到可用图片或视频' }, { status: 500 });
      }

      const images = post.images.map((image) => ({
        index: image.index,
        previewUrl: image.previewUrl,
        originalUrl: image.originalUrl,
        liveUrl: image.liveUrl,
        urlDefault: image.urlDefault,
        urlPre: image.urlPre,
        width: image.width,
        height: image.height,
      }));
      const firstPreviewUrl = images[0]?.previewUrl || images[0]?.originalUrl || '';

      return NextResponse.json({
        success: true,
        platform: 'xiaohongshu',
        mediaType: 'image',
        videoId: post.noteId,
        title: post.title ?? '',
        desc: post.desc ?? '',
        videoUrl: '',
        ossUrl: firstPreviewUrl,
        coverUrl: post.coverUrl || firstPreviewUrl,
        images,
        imageCount: images.length,
        liveCount: images.filter((image) => image.liveUrl).length,
        noteData: post,
        savePending: true,
        watermark: false,
        uploadProvider: exportConfig.provider,
      });
    }

    const { cookieStr, source: authSource } = await resolveDouyinCookieForParse(authOpt);
    uploadTarget.downloadCookie = cookieStr ?? undefined;

    let parsed = watermark
      ? await parseDouyinFast(url)
      : await parseDouyin(url, { cookieStr: cookieStr ?? undefined });

    const ossKey = `${parsed.platform}/${parsed.videoId}.mp4`;
    let ossUrl = '';

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const localFile = (parsed as { localFile?: string }).localFile;
        ossUrl = localFile
          ? await uploadFromFile(localFile, ossKey, 'video/mp4', uploadTarget)
          : await uploadVideoFromUrl(parsed.videoUrl, ossKey, uploadTarget);
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        parsed = watermark
          ? await parseDouyinFast(url)
          : await parseDouyin(url, { cookieStr: cookieStr ?? undefined });
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
      uploadProvider: exportConfig.provider,
      authSource,
      hasLogin: hasValidDouyinCookie(cookieStr ?? getPlatformDouyinCookie()),
    };

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
