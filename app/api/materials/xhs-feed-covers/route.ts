import { NextRequest, NextResponse } from 'next/server';
import { getXhsCookie } from '@/lib/analysis/xhs-cookie';
import { addMaterial, getMaterialBySourceUrl } from '@/lib/materials';
import { uploadXhsImageFromUrl } from '@/lib/oss';

type FeedItem = {
  id?: string;
  xsec_token?: string;
  note_card?: {
    display_title?: string;
    cover?: {
      url?: string;
      url_default?: string;
      info_list?: Array<{ url?: string; image_scene?: string }>;
    };
  };
};

type FeedCover = {
  url?: string;
  url_default?: string;
  info_list?: Array<{ url?: string; image_scene?: string }>;
};

function normalizeImageUrl(url?: string) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  return url;
}

function pickCoverUrl(cover?: FeedCover) {
  if (!cover) return '';
  if (cover.url_default) return normalizeImageUrl(cover.url_default);
  if (cover.url) return normalizeImageUrl(cover.url);
  if (cover.info_list && cover.info_list.length > 0) {
    const best = cover.info_list.find((i) => String(i.image_scene || '').includes('WM')) || cover.info_list[cover.info_list.length - 1];
    return normalizeImageUrl(best?.url);
  }
  return '';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { items?: FeedItem[] };
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      return NextResponse.json({ ok: true, savedCount: 0, skippedCount: 0, errors: [] });
    }

    const cookie = getXhsCookie() || undefined;
    let savedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const sourceUrl = pickCoverUrl(item.note_card?.cover);
      if (!sourceUrl) {
        skippedCount += 1;
        continue;
      }

      if (getMaterialBySourceUrl(sourceUrl)) {
        skippedCount += 1;
        continue;
      }

      try {
        const ext = sourceUrl.includes('.png') ? 'png' : sourceUrl.includes('.webp') ? 'webp' : 'jpg';
        const ossUrl = await uploadXhsImageFromUrl(
          sourceUrl,
          `xhs/feed-covers/${item.id || Date.now()}_${String(i + 1).padStart(2, '0')}.${ext}`,
          cookie
        );

        addMaterial({
          platform: 'xiaohongshu',
          mediaType: 'image',
          title: item.note_card?.display_title
            ? `${item.note_card.display_title} · 封面`
            : `小红书热门封面 ${i + 1}`,
          videoUrl: '',
          ossUrl,
          coverUrl: ossUrl,
          sourceUrl,
          sourceNoteId: item.id,
          sourcePostUrl: item.id
            ? `https://www.xiaohongshu.com/explore/${item.id}${item.xsec_token ? `?xsec_token=${item.xsec_token}&xsec_source=pc_feed` : ''}`
            : undefined,
        });
        savedCount += 1;
      } catch (error) {
        errors.push(`第 ${i + 1} 条封面保存失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return NextResponse.json({
      ok: true,
      savedCount,
      skippedCount,
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
