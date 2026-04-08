import { NextRequest, NextResponse } from 'next/server';
import { fetchXhsPost } from '@/lib/analysis/xhs-fetch';
import { getXhsFeed } from '@/lib/analysis/xhs-backend';
import { getXhsCookie } from '@/lib/analysis/xhs-cookie';
import { getMaterialById, linkMaterialsBySourceNoteId, updateMaterialById } from '@/lib/materials';

function buildPostUrl(sourcePostUrl?: string, sourceNoteId?: string) {
  if (sourcePostUrl) return sourcePostUrl;
  if (sourceNoteId) return `https://www.xiaohongshu.com/discovery/item/${sourceNoteId}`;
  return '';
}

function getFeedItems(payload: unknown): Array<{ id?: string; xsec_token?: string }> {
  if (!payload || typeof payload !== 'object') return [];
  const data = payload as { data?: { items?: Array<{ id?: string; xsec_token?: string }> }; items?: Array<{ id?: string; xsec_token?: string }> };
  return data.items || data.data?.items || [];
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const material = getMaterialById(id);
    if (!material) {
      return NextResponse.json({ error: '素材不存在' }, { status: 404 });
    }

    if (material.relatedContentId) {
      return NextResponse.json({ ok: true, relatedContentId: material.relatedContentId, linkedCount: 0 });
    }

    const initialUrl = buildPostUrl(material.sourcePostUrl, material.sourceNoteId);
    if (!initialUrl) {
      return NextResponse.json({ error: '缺少来源链接，无法自动解析' }, { status: 400 });
    }

    let postData;
    let resolvedUrl = initialUrl;
    let lastError = '';
    const candidates = [initialUrl];

    // xsec_token 可能过期：从实时 feed 补一个新的 token 再重试。
    if (material.sourceNoteId) {
      const cookie = getXhsCookie();
      if (cookie) {
        try {
          const feed = await getXhsFeed(cookie);
          const matched = getFeedItems(feed).find((i) => i.id === material.sourceNoteId);
          if (matched?.xsec_token) {
            const refreshed = `https://www.xiaohongshu.com/explore/${material.sourceNoteId}?xsec_token=${matched.xsec_token}&xsec_source=pc_feed`;
            if (!candidates.includes(refreshed)) candidates.push(refreshed);
          }
        } catch {
          // ignore feed refresh error and continue with existing candidates
        }
      }
      const fallbackDiscovery = `https://www.xiaohongshu.com/discovery/item/${material.sourceNoteId}`;
      if (!candidates.includes(fallbackDiscovery)) candidates.push(fallbackDiscovery);
    }

    for (const url of candidates) {
      try {
        postData = await fetchXhsPost(url);
        resolvedUrl = url;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!postData) {
      return NextResponse.json({ error: lastError || '解析失败' }, { status: 500 });
    }

    if (resolvedUrl !== material.sourcePostUrl) {
      updateMaterialById(id, { sourcePostUrl: resolvedUrl });
    }

    const saveUrl = new URL('/api/content/save/xhs', req.url).toString();
    const saveRes = await fetch(saveUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noteData: postData,
        originalUrl: resolvedUrl,
        comments: [],
      }),
      cache: 'no-store',
    });
    const saveResult = await saveRes.json();
    if (!saveRes.ok || !saveResult?.success) {
      return NextResponse.json(
        { error: saveResult?.error || `保存失败（HTTP ${saveRes.status}）` },
        { status: 500 }
      );
    }

    const contentId = String(saveResult?.data?.post?.id || '');
    const linkedCount = postData.noteId && contentId
      ? linkMaterialsBySourceNoteId(postData.noteId, contentId)
      : 0;

    return NextResponse.json({
      ok: true,
      relatedContentId: contentId || null,
      linkedCount,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
