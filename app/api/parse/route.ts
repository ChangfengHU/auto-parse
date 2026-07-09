import { NextRequest, NextResponse } from 'next/server';
import { parseDouyin, parseDouyinFast } from '@/lib/parsers/douyin';
import { fetchXhsPost } from '@/lib/analysis/xhs-fetch';
import { parseWechat } from '@/lib/parsers/wechat-playwright';
import { publishWechatHtml } from '@/lib/wechat-html-publisher';
import { uploadVideoFromUrl, uploadFromFile, uploadFromUrl, type UploadTargetOptions } from '@/lib/oss';
import { addMaterial } from '@/lib/materials';
import { resolveDouyinCookieForParse, getPlatformDouyinCookie, hasValidDouyinCookie } from '@/lib/parse/resolve-auth';
import type { ParseExportConfig, ParseRequestOptions } from '@/lib/parse/types';
import { DEFAULT_PARSE_EXPORT_CONFIG } from '@/lib/parse/types';

export const maxDuration = 600;

function hasSupabaseUploadConfig(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

function mergeExportConfig(partial?: ParseRequestOptions['export']): ParseExportConfig {
  const requestedProvider = partial?.provider ?? DEFAULT_PARSE_EXPORT_CONFIG.provider;
  const provider = requestedProvider === 'supabase' && !hasSupabaseUploadConfig() ? 'r2' : requestedProvider;

  return {
    provider,
    r2: {
      ...DEFAULT_PARSE_EXPORT_CONFIG.r2,
      ...(partial?.r2 ?? {}),
    },
  };
}

function pickImageExt(url: string): string {
  const cleanPath = url.split(/[?#]/)[0];
  const match = cleanPath.match(/\.([a-zA-Z0-9]{2,8})(?:$|\/)/);
  return match?.[1]?.toLowerCase() || 'jpg';
}

function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
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
    const isWechat =
      url.includes('weixin.qq.com/sph/') || url.includes('channels.weixin.qq.com') || url.includes('mp.weixin.qq.com/s/');

    if (!isDouyin && !isXhs && !isWechat) {
      return NextResponse.json(
        { error: '暂不支持该平台，目前支持抖音、小红书、微信视频号/公众号' },
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

    if (isWechat) {
      const parsed = await parseWechat(url);
      let ossUrl = '';
      const sourceVideoUrl = (parsed as { videoUrl?: string }).videoUrl;
      if (parsed.sourceType === 'channels' && sourceVideoUrl) {
        const videoId = (parsed as { dynamicExportId?: string }).dynamicExportId
          ? String((parsed as { dynamicExportId?: string }).dynamicExportId).split('/').pop()
          : `wechat-${Date.now()}`;
        ossUrl = await uploadVideoFromUrl(sourceVideoUrl, `wechat/${videoId}.mp4`, uploadTarget);
      }
      const published = await publishWechatHtml(parsed, exportConfig.r2);
      return NextResponse.json({
        ...parsed,
        ossUrl,
        htmlUrl: published.htmlUrl,
        coverOssUrl: published.coverOssUrl,
        images: published.images,
        imageCount: published.images.length,
        uploadProvider: 'r2',
      });
    }

    const { cookieStr, source: authSource } = await resolveDouyinCookieForParse(authOpt);
    uploadTarget.downloadCookie = cookieStr ?? undefined;

    let parsed = watermark
      ? await parseDouyinFast(url)
      : await parseDouyin(url, { cookieStr: cookieStr ?? undefined });

    const isImageResult = parsed.mediaType === 'image';
    let ossUrl = '';
    let images = (parsed.images as Array<{ url: string }> | undefined) ?? [];
    images = images.filter((image) => isHttpUrl(image.url));

    if (isImageResult && images.length > 0) {
      const uploadedImages = await Promise.all(
        images.map(async (image, index) => {
          try {
            const ext = pickImageExt(image.url);
            const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
            const imageKey = `${parsed.platform}/${parsed.videoId}/img-${index + 1}.${ext}`;
            const uploadedUrl = await uploadFromUrl(image.url, imageKey, contentType);
            return { ...image, url: uploadedUrl };
          } catch (e) {
            console.warn('[parse] douyin image upload failed', e instanceof Error ? e.message : e);
            return image;
          }
        })
      );
      images = uploadedImages;
      ossUrl = uploadedImages[0]?.url || '';
    } else {
      const ossKey = `${parsed.platform}/${parsed.videoId}.mp4`;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const localFile = (parsed as { localFile?: string }).localFile;
          if (!parsed.videoUrl) {
            throw new Error('未获取到视频地址');
          }
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
    }

    const result = {
      success: true,
      platform: parsed.platform,
      mediaType: (parsed.mediaType as 'video' | 'image' | undefined) ?? 'video',
      videoId: parsed.videoId,
      title: parsed.title ?? '',
      desc: parsed.desc ?? parsed.title ?? '',
      videoUrl: parsed.videoUrl,
      ossUrl,
      coverUrl: parsed.coverUrl ?? '',
      cover: parsed.cover,
      author: parsed.author,
      music: parsed.music,
      statistics: parsed.statistics,
      hashtags: parsed.hashtags ?? [],
      mentions: parsed.mentions ?? [],
      createTime: parsed.createTime,
      shareUrl: parsed.shareUrl ?? '',
      videoMeta: parsed.videoMeta,
      images: isImageResult ? images : undefined,
      imageCount: isImageResult ? images.length : undefined,
      watermark: (parsed as { watermark?: boolean }).watermark ?? watermark,
      uploadProvider: exportConfig.provider,
      authSource,
      hasLogin: hasValidDouyinCookie(cookieStr ?? getPlatformDouyinCookie()),
    };

    const materialVideoUrl = isImageResult ? (images[0]?.url || '') : result.videoUrl;
    addMaterial({
      platform: result.platform,
      title: result.title,
      videoUrl: materialVideoUrl,
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
